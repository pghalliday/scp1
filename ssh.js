'use strict';

const Client = require('ssh2').Client;
const fs = require('fs');
const path = require('path');
const co = require('co');
const Rx = require('rx-lite');

const LOCAL_FILE = 'test';
const REMOTE_FILE = '/scp_test';

const SSH_PARAMS = {
  host: 'localhost',
  port: 2222,
  username: 'root',
  algorithms: {
    serverHostKey: [
      'ssh-dss'
    ]
  },
  readyTimeout: 60000,
  debug: (text) => {
//    console.log(text);
  }
};

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

const connect = () => {
  const connection = new Client();
  connection.connect(SSH_PARAMS);
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

co(function* () {
  const remote_directory = path.dirname(REMOTE_FILE);
  const remote_file = path.basename(REMOTE_FILE);
  const connection = yield connect();
  console.log('connected');
  try {
    const stream  = yield startScpSink(connection, remote_directory);
    console.log('SCP sink started');
  } finally {
    yield disconnect(connection);
    console.log('disconnected');
  }
}).catch(error => {
  console.error(error);
  process.exit(10);
});
