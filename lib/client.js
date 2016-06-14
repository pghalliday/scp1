'use strict';

const EventEmitter = require('events');
const Connection = require('ssh2').Client;
const co = require('co');
const path = require('path');
const Rx = require('rx-lite');
const fs = require('fs');

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
    return promiseForErrorOrValue(this.errorObservables.concat(dataEvents))
    .then(data => {
      message += data.toString('utf8');
      if (message.endsWith('\n')) throw new Error(message);
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
      if (message.endsWith('\n')) throw new Error(message);
      return this.promiseForErrorOrMessageEnd(dataEvents, message);
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
    const execEvents = exec('scp -t ' + directory);
    return promiseForErrorOrValue(this.errorObservables.concat(execEvents))
    .then(stream => {
      this.stream = stream;
      this.errorObservables.push(Rx.Observable.fromEvent(this.stream, 'error', createEvent.bind(null, 'error')));
    });
  }

  sendProtocolMessage(mode, fileSize, remoteFile) {
    const protocolMessage = `C0${mode.toString(8)} ${fileSize} ${remoteFile}`;
    this.info(protocolMessage);
    this.stream.write(protocolMessage);
    this.stream.write('\n');
    return this.promiseForErrorOrSCPConfirmation();
  }

  sendFile(fileData) {
    this.info('Sending file data');
    this.stream.write(fileData);
    this.stream.write(new Buffer([0]));
    return this.promiseForErrorOrSCPConfirmation();
  }

  disconnect() {
    this.info('disconnecting');
    this.connection.end();
    return this.promiseForConnectionState('end');
  }

  put(localFile, remoteFile, mode) {
    this.errorObservables = [];
    const self = this;
    return co(function* () {
      const remoteDirectory = path.dirname(remoteFile);
      const remoteBaseName = path.basename(remoteFile);
      self.info(`Reading file data from ${localFile}`);
      const fileData = yield getFileData(localFile);
      const fileSize = fileData.length;
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

  get(remoteFile, localFile) {
    this.info('Get not implemented yet');
  }
}

module.exports = Client;
