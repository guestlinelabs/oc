import path from 'node:path';
import strings from '../../resources';
import type { Component, Config, TemplateInfo } from '../../types';
import { getOcConfig } from '../../utils/ocConfig';
import type {
  OcHandler,
  OcRequest,
  OcResponse
} from '../domain/http-server/types';
import type { Repository } from '../domain/repository';
import * as urlBuilder from '../domain/url-builder';
import previewView from '../views/preview';
import * as getComponentFallback from './helpers/get-component-fallback';
import {
  sendTransformInfoError,
  transformInfo
} from './helpers/transform-info';

function componentPreview(
  err: any,
  req: OcRequest,
  res: OcResponse,
  component: Component,
  templates: TemplateInfo[]
): void | Promise<void> {
  if (err) {
    res.errorDetails = err.registryError || err;
    res.errorCode = 'NOT_FOUND';
    res.status(404).json(err);
    return;
  }

  let liveReload = '';
  if (res.conf.liveReloadPort) {
    liveReload = `<script src="http://localhost:${res.conf.liveReloadPort}/livereload.js?snipver=1"></script>`;
  }

  const isHtmlRequest =
    !!req.headers.accept && req.headers.accept.indexOf('text/html') >= 0;

  if (isHtmlRequest) {
    res.send(
      previewView({
        robots: res.conf.discovery.robots,
        component,
        imports:
          getOcConfig(
            // In `oc dev`, start the oc.json lookup at the component's own
            // folder (it still walks up to the components dir and beyond), so
            // a standalone component repo can carry its own dev import map.
            res.conf.local
              ? path.join(res.conf.path, component.name)
              : res.conf.path
          )?.development?.importmap?.imports ||
          res.conf.compiledClient?.imports,
        fallbackClient: res.conf.fallbackClient
          ? `${res.conf.fallbackRegistryUrl.replace(/\/$/, '')}/oc-client/client.dev.js`
          : undefined,
        href: res.conf.baseUrl,
        liveReload,
        qs: urlBuilder.queryString(req.query as any),
        templates
      })
    );
  } else if (res.conf.discovery.api) {
    return transformInfo(res.conf, component).then(
      (info) =>
        res.status(200).json({
          ...info,
          requestVersion: req.params['componentVersion'] || ''
        }),
      (transformErr) => sendTransformInfoError(res, transformErr)
    );
  } else {
    res.status(401).json({
      code: 'DISCOVERY_API_DISABLED',
      error: strings.errors.registry.DISCOVERY_API_DISABLED
    });
  }
}

export default function componentPreviewRoute(
  conf: Config,
  repository: Repository
): OcHandler {
  return async (req, res): Promise<void> => {
    let registryError: unknown;
    let component: Component | undefined;
    try {
      component = await repository.getComponent(
        req.params['componentName'],
        req.params['componentVersion']
      );
    } catch (err) {
      registryError = err;
    }

    if (registryError && conf.fallbackRegistryUrl) {
      return getComponentFallback.getComponentPreview(
        conf,
        req,
        res,
        registryError,
        (fallbackError, fallbackComponent) => {
          componentPreview(
            fallbackError,
            req,
            res,
            fallbackComponent,
            repository.getTemplatesInfo()
          );
        }
      );
    }

    return componentPreview(
      registryError,
      req,
      res,
      component!,
      repository.getTemplatesInfo()
    );
  };
}
