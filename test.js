'use strict';

const SCP1 = require('./');

const LOCAL_FILE = 'test1';
const REMOTE_FILE = '/scp_test';
const NEXT_LOCAL_FILE = 'test2';

const SSH_PARAMS = {
  host: 'c1-stb',
  port: 22,
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

const client = new SCP1(SSH_PARAMS)

client.on('info', message => {
  console.log(message);
});

client.put(LOCAL_FILE, REMOTE_FILE, parseInt('0640', 8))
.then(client.get.bind(client, REMOTE_FILE, NEXT_LOCAL_FILE, parseInt('0755', 8)))
.catch(error => {
  console.error(error);
});
