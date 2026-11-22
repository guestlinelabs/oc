// Test helpers for host registries. These mirror the deep `oc/dist/...`
// imports that host applications used with upstream `oc`:
//   oc/dist/registry/domain/version-handler        -> version helpers below
//   oc/dist/registry/routes/helpers/get-component  -> getComponent below
//   oc/dist/registry/domain/repository (types)     -> repository/Repository
//   oc/dist/types                                  -> "@guestlinelabs/oc-registry/types"

export type { Repository } from '../registry/domain/repository';
export { default as repository } from '../registry/domain/repository';
export {
  getAvailableVersion,
  getLatestVersion,
  validateNewVersion
} from '../registry/domain/version-handler';
export type {
  GetComponentResult,
  RenderComponent,
  RendererOptions
} from '../registry/routes/helpers/get-component';
export {
  default,
  default as getComponent,
  stream
} from '../registry/routes/helpers/get-component';
