# node-scp

A pure NodeJS, real SCP implementation (not SFTP!).
Depends on the pure node SSH implementation from [ssh2](https://www.npmjs.com/package/ssh2)

# Usage

```
npm install scp1
```

```javascript
const SCP1 = require('scp1')

// options are those for the SSH connection as required
// by the `ssh2` library
const client = new SCP1({
  host: 'myhost',
  port: 22,
  username: 'myuser',
  readyTimeout: 60000
})

// First create a promise to put a file on the remote system
client.put(localFile, remoteFile, mode)
// then create a promise to get get the file from the remote system
.then(client.get.bind(client, remoteFile, localFile))
// catch any errors
.catch(error => {
  console.error(error);
});
```
