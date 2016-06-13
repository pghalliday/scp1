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

const getFileSize = file => {
  return new Promise((resolve, reject) => {
    fs.stat(file, (error, stat) => {
      if (error) {
        reject(error);
      } else {
        resolve(stat.size);
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
  };

  connect(options) {
    this.connection = new Connection();
    this.connection.connect(options);
    this.errorObservables.push(Rx.Observable.fromEvent(this.connection, 'error', createEvent.bind(null, 'error')));
    return this.promiseForConnectionState('ready');
  };

  startScpSink(directory) {
    const exec = Rx.Observable.fromNodeCallback(this.connection.exec.bind(this.connection), null, createEvent.bind(null, 'exec'));
    const execEvents = exec('scp -t ' + directory);
    return promiseForErrorOrValue(this.errorObservables.concat(execEvents))
    .then(stream => {
      this.stream = stream;
    });
  };

  sendProtocolMessage(mode, fileSize, remoteFile) {
    return Promise.resolve();
  };

  disconnect() {
    this.connection.end();
    return this.promiseForConnectionState('end');
  };

  put(localFile, remoteFile, mode) {
    const self = this;
    return co(function* () {
      const remote_directory = path.dirname(remoteFile);
      const remote_file = path.basename(remoteFile);
      const fileSize = yield getFileSize(localFile);
      self.info('Sending file with length ' + fileSize + ' bytes');
      yield self.connect(self.options);
      self.info('connected');
      try {
        yield self.startScpSink(remote_directory);
        self.info('SCP sink started');
        yield self.sendProtocolMessage(mode, fileSize, remoteFile);
        self.info('Sent protocol message');
      } finally {
        yield self.disconnect();
        self.info('disconnected');
      }
    });
  }

  get(remoteFile, localFile) {
    this.info('Get not implemented yet');
  }
}

module.exports = Client;
