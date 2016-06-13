'use strict';

const SCP1 = require('./');

const LOCAL_FILE = 'test1';
const REMOTE_FILE = '/scp_test';
const NEXT_LOCAL_FILE = 'test2';

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

const client = new SCP1(SSH_PARAMS)

client.on('info', message => {
  console.log(message);
});

client.put(LOCAL_FILE, REMOTE_FILE)
.then(client.get.bind(client, REMOTE_FILE, LOCAL_FILE))
.catch(error => {
  console.error(error);
});
