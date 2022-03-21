'use strict';

const EventEmitter = require('events');
const Connection = require('ssh2').Client;
const co = require('co');
const path = require('path');
const Rx = require('rx-lite');
const fs = require('fs');

const parseProtocolMessage = function(message) {
  message = message.slice(1, -1);
  const fields = message.split(' ');
  return {
    mode: parseInt(fields[0], 8),
    size: parseInt(fields[1])
  }
}

const createEvent = function(type) {
  return {
    type: type,
    args: Array.prototype.slice.call(arguments, 1)
  };
};

const promiseForErrorOrValue = function(observables) {
  return new Promise((resolve, reject) => {
    const events = Rx.Observable.merge(observables).take(1);
    let error;
    let value;
    events.subscribe(event => {
      if (event.type === 'error') {
        error = event.args[0];
      } else {
        value = event.args[0];
      }
    }, error => {
      reject(error);
    }, () => {
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    });
  });
}

const getFileStat = file => {
  return new Promise((resolve, reject) => {
    fs.stat(file, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
};

const getFileData = file => {
  return new Promise((resolve, reject) => {
    fs.readFile(file, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
};

const writeFileData = (file, data, mode) => {
  return new Promise((resolve, reject) => {
    fs.writeFile(file, data, {mode: mode}, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

class Client extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.errorObservables = [];
  }

  info(message) {
    this.emit('info', message);
  }

  promiseForConnectionState(state) {
    const stateEvents = Rx.Observable.fromEvent(this.connection, state, createEvent.bind(null, state));
    return promiseForErrorOrValue(this.errorObservables.concat(stateEvents));
  }

  promiseForErrorOrMessageEnd(dataEvents, message) {
    if (message.endsWith('\n')) return Promise.resolve(message);
    return promiseForErrorOrValue(this.errorObservables.concat(dataEvents))
    .then(data => {
      message += data.toString('utf8');
      return this.promiseForErrorOrMessageEnd(dataEvents, message);
    });
  }

  promiseForErrorOrSCPConfirmation() {
    const dataEvents = Rx.Observable.fromEvent(this.stream, 'data', createEvent.bind(null, 'data'));
    return promiseForErrorOrValue(this.errorObservables.concat(dataEvents))
    .then(data => {
      const code = data.readInt8(0);
      if (code === 0) return;
      const message = data.toString('utf8', 1);
      return this.promiseForErrorOrMessageEnd(dataEvents, message)
      .then(message => {
        throw new Error(message);
      });
    });;
  }

  promiseForErrorOrClose() {
    const closeEvents = Rx.Observable.fromEvent(this.stream, 'close', createEvent.bind(null, 'close'));
    return promiseForErrorOrValue(this.errorObservables.concat(closeEvents));
  }

  connect(options) {
    this.info(`Connecting with options ${JSON.stringify(options)}`);
    this.connection = new Connection();
    this.connection.connect(options);
    this.errorObservables.push(Rx.Observable.fromEvent(this.connection, 'error', createEvent.bind(null, 'error')));
    return this.promiseForConnectionState('ready');
  }

  startScpSink(directory) {
    this.info(`Starting SCP sink for directory ${directory}`);
    const exec = Rx.Observable.fromNodeCallback(this.connection.exec.bind(this.connection), null, createEvent.bind(null, 'exec'));
    const execEvents = exec(`scp -t ${directory}`);
    return promiseForErrorOrValue(this.errorObservables.concat(execEvents))
    .then(stream => {
      this.stream = stream;
      this.errorObservables.push(Rx.Observable.fromEvent(this.stream, 'error', createEvent.bind(null, 'error')));
    });
  }

  streamWrite(fileData, encoding) {
    return new Promise(((resolve) => {
      this.stream.write(fileData, encoding, function (){
        resolve();
      })
    }))
  }

  sendProtocolMessage(mode, fileSize, remoteFile) {
    const protocolMessage = `C0${mode.toString(8)} ${fileSize} ${remoteFile}`;
    this.info(protocolMessage);
    return this.streamWrite(protocolMessage, null)
        .then(() => {
          return this.streamWrite('\n', null);
        })
        .then(() => {
          return this.promiseForErrorOrSCPConfirmation();
        });
  }

  sendFile(fileData) {
    this.info('Sending file data');

    return this.streamWrite(fileData, null)
        .then(() => {
          return this.streamWrite(Buffer.from([0]), null);
        })
        .then(() => {
          return this.promiseForErrorOrSCPConfirmation();
        });
  }

  promiseForErrorOrProtocolMessage() {
    const dataEvents = Rx.Observable.fromEvent(this.stream, 'data', createEvent.bind(null, 'data'));
    return promiseForErrorOrValue(this.errorObservables.concat(dataEvents))
    .then(data => {
      const message = data.toString('utf8');
      return this.promiseForErrorOrMessageEnd(dataEvents, message);
    })
    .then(message => {
      this.info(message.slice(0, -1));
      return message;
    })
    .then(parseProtocolMessage);
  }

  promiseForErrorOrFileData(buffer, size, dataEvents) {
    // Collect the final 0 byte too as it often comes in
    // the same data event as the last chunk of file
    if (buffer.length === size + 1) return Promise.resolve(buffer.slice(0, -1));
    return promiseForErrorOrValue(this.errorObservables.concat(dataEvents))
    .then(data => {
      buffer = Buffer.concat([buffer, data]);
      return this.promiseForErrorOrFileData(buffer, size, dataEvents);
    })
  }

  startScpSource(file) {
    this.info(`Starting SCP source for file ${file}`);
    const exec = Rx.Observable.fromNodeCallback(this.connection.exec.bind(this.connection), null, createEvent.bind(null, 'exec'));
    const execEvents = exec(`scp -f ${file}`);
    return promiseForErrorOrValue(this.errorObservables.concat(execEvents))
    .then(stream => {
      this.stream = stream;
      this.errorObservables.push(Rx.Observable.fromEvent(this.stream, 'error', createEvent.bind(null, 'error')));
    });
  }

  getProtocolMessage() {
    this.info('Starting transfer');
    this.stream.write(Buffer.from([0]));
    return this.promiseForErrorOrProtocolMessage();
  }

  receiveFile(size) {
    this.info(`Receiving file with ${size} bytes`);
    this.stream.write(Buffer.from([0]));
    const dataEvents = Rx.Observable.fromEvent(this.stream, 'data', createEvent.bind(null, 'data'));
    return this.promiseForErrorOrFileData(Buffer.from([]), size, dataEvents);
  }

  endTransfer() {
    this.info('Ending transfer');
    this.stream.write(Buffer.from([0]));
    return this.promiseForErrorOrClose();
  }

  disconnect() {
    this.info('Disconnecting');
    this.connection.end();
    return this.promiseForConnectionState('end');
  }

  put(localFile, remoteFile, mode) {
    this.errorObservables = [];
    const self = this;
    return co(function* () {
      const remoteDirectory = path.dirname(remoteFile);
      const remoteBaseName = path.basename(remoteFile);
      self.info(`Reading file stats from ${localFile}`);
      const fileStat = yield getFileStat(localFile);
      mode = mode || fileStat.mode & 511;
      const fileSize = fileStat.size;
      self.info(`Reading file data from ${localFile}`);
      const fileData = yield getFileData(localFile);
      yield self.connect(self.options);
      try {
        yield self.startScpSink(remoteDirectory);
        yield self.sendProtocolMessage(mode, fileSize, remoteBaseName);
        yield self.sendFile(fileData);
      } finally {
        yield self.disconnect();
      }
    });
  }

  get(remoteFile, localFile, mode) {
    this.errorObservables = [];
    const self = this;
    return co(function* () {
      let fileData = '';
      yield self.connect(self.options);
      try {
        yield self.startScpSource(remoteFile);
        const protocolMessage = yield self.getProtocolMessage();
        mode = mode || protocolMessage.mode;
        const fileData = yield self.receiveFile(protocolMessage.size);
        self.info(`Writing file data to ${localFile}`);
        yield writeFileData(localFile, fileData, mode);
        yield self.endTransfer();
      } finally {
        yield self.disconnect();
      }
    });
  }
}

module.exports = Client;
