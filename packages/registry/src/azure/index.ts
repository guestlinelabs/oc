// Entry point for the "@guestlinelabs/oc-registry/azure" subpath export.
// Mirrors oc-azure-storage-adapter: `require()`/default import yields the
// adapter factory directly.
import azureAdapter from '../storage/azure';

export default azureAdapter;
export type { AzureConfig } from '../storage/azure';

module.exports = azureAdapter;
