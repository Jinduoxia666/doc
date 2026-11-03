// Cursor agent sandbox blocks uv_interface_addresses; Vite calls it in resolveServerUrls.
const os = require('node:os')
try {
  os.networkInterfaces()
} catch {
  os.networkInterfaces = () => ({
    lo0: [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: true,
        cidr: '127.0.0.1/8',
      },
    ],
  })
}
