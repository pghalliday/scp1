'use strict';

const EventEmitter = require('events');
const Connection = require('ssh2').Client;
const co = require('co');
const path = require('path');
const Rx = require('rx-lite');

const createEvent = function(type, ...args) {
  return {
    type: type,
    args: args
  };
};

const promiseForErrorOrValue = function(...observables) {
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

const promiseForConnectionState = (connection, state) => {
  const readyEvents = Rx.Observable.fromEvent(connection, state, createEvent.bind(null, state));
  const errorEvents = Rx.Observable.fromEvent(connection, 'error', createEvent.bind(null, 'error'));
  return promiseForErrorOrValue(readyEvents, errorEvents);
};

const connect = options => {
  const connection = new Connection();
  connection.connect(options);
  return promiseForConnectionState(connection, 'ready').then(() => connection);;
};

const startScpSink = (connection, directory) => {
  const errorEvents = Rx.Observable.fromEvent(connection, 'error', createEvent.bind(null, 'error'));
  const exec = Rx.Observable.fromNodeCallback(connection.exec.bind(connection), null, createEvent.bind(null, 'exec'));
  const execEvents = exec('scp -t ' + directory);
  return promiseForErrorOrValue(execEvents, errorEvents);
};

const disconnect = connection => {
  connection.end();
  return promiseForConnectionState(connection, 'end');
};

class Client extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  info(message) {
    this.emit('info', message);
  }

  put(localFile, remoteFile) {
    const self = this;
    return co(function* () {
      const remote_directory = path.dirname(remoteFile);
      const remote_file = path.basename(remoteFile);
      const connection = yield connect(self.options);
      self.info('connected');
      try {
        const stream  = yield startScpSink(connection, remote_directory);
        self.info('SCP sink started');
      } finally {
        yield disconnect(connection);
        self.info('disconnected');
      }
    });
  }

  get(remoteFile, localFile) {
    info('Get not implemented yet');
  }
}

module.exports = Client;
