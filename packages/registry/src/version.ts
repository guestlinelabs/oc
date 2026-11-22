/**
 * OC-compatible version reported to consumers.
 *
 * The published package version (`@guestlinelabs/oc-registry`,
 * `@guestlinelabs/oc`) is independent from the OC protocol version that
 * registries and CLIs exchange: the `ocVersion` field of the component list
 * response, `minOcVersion` template checks, the `oc-cli-<version>` user
 * agent, `oc.version` stamped into packaged components and the vendored
 * `oc-client` component version all stay at the upstream `oc@0.50.67`
 * value so existing components, template compilers and host registries keep
 * working unchanged.
 */
export const OC_VERSION = '0.50.67';
