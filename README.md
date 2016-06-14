# node-scp

A pure NodeJS, real SCP implementation (not SFTP!).
Depends on the pure node SSH implementation from [ssh2](https://www.npmjs.com/package/ssh2)

Note that although effort has been made to handle error conditions, this is still a basic implementation of all the functionality I needed at the time. It is not a full implementation of the SCP protocol and in fact can only be used for sending and receiving single files without support for file times.

(It's also a bit of an experiment in observables and generator functions so please excuse the coding style and lack of tests - sorry!)

Pull requests are welcome as always :)

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
// If mode is not specified then the existing local file mode is used
// If the file exists on the remote system, its mode will not be changed
client.put(localFile, remoteFile, mode)
// then create a promise to get get the file from the remote system
// If mode is not specified then the existing remote file mode is used
// If the file exists on the local system, its mode will not be changed
.then(client.get.bind(client, remoteFile, localFile, mode))
// catch any errors
.catch(error => {
  console.error(error);
});
```
