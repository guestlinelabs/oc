// Test helpers for host registries. These mirror the deep `oc/dist/...`
// imports that host applications used with upstream `oc`:
//   oc/dist/registry/domain/version-handler        -> version helpers below
//   oc/dist/registry/routes/helpers/get-component  -> getComponent below
//   oc/dist/registry/domain/repository (types)     -> repository/Repository
//   oc/dist/types                                  -> "@guestlinelabs/oc-registry/types"

export {
  getAvailableVersion,
  getLatestVersion,
  validateNewVersion
} from '../registry/domain/version-handler';

export { default } from '../registry/routes/helpers/get-component';
export { default as getComponent } from '../registry/routes/helpers/get-component';
export type {
  GetComponentResult,
  RenderComponent,
  RendererOptions
} from '../registry/routes/helpers/get-component';
export { stream } from '../registry/routes/helpers/get-component';

export { default as repository } from '../registry/domain/repository';
export type { Repository } from '../registry/domain/repository';
