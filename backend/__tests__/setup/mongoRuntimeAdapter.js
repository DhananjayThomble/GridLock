/**
 * Jest setup: supply the MongoDB driver's `os` runtime adapter explicitly.
 *
 * mongoose >= 9.7 bundles mongodb driver 7.x, which loads the Node `os` module
 * for its connection-handshake client metadata via a dynamic `import('os')`
 * (see mongodb/lib/runtime_adapters.js). Inside Jest's VM sandbox that dynamic
 * import resolves to a module namespace whose `os.platform()` etc. are not
 * callable, so metadata construction throws and the driver sends a handshake
 * missing the required `driver` sub-document. The server then rejects the
 * connection (ClientMetadataMissingField) and `mongoose.connect()` hangs.
 *
 * The driver exposes an escape hatch — `runtimeAdapters.os` in the client
 * options — to bypass the dynamic import. Here we wrap `mongoose.connect` so
 * every test connection passes the real `os` module, with no change to any
 * individual suite and no effect on production code (this file is test-only).
 */

const os = require('os');
const mongoose = require('mongoose');

const originalConnect = mongoose.connect.bind(mongoose);

mongoose.connect = function patchedConnect(uri, options = {}, ...rest) {
  const merged = {
    ...options,
    runtimeAdapters: { os, ...(options.runtimeAdapters || {}) },
  };
  return originalConnect(uri, merged, ...rest);
};
