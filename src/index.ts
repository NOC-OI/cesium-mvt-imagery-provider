import Point from "@mapbox/point-geometry";
import { VectorTile, VectorTileFeature, VectorTileLayer } from "@mapbox/vector-tile";
import {
  ImageryProvider,
  ImageryTypes,
  Rectangle,
  Request,
  WebMercatorTilingScheme,
  Event as CesiumEvent,
  Resource,
  ImageryLayerFeatureInfo,
  Cartesian2,
  Cartographic,
  Credit,
} from "cesium";
import Pbf from "pbf";

import { isFeatureClicked } from "./terria";
import { isLineStringClicked, isPointClicked } from "./util";

const defaultParseTile = async (url?: string, headers?: any) => {
  const ab = await fetchResourceAsArrayBuffer(url, headers);
  if (!ab) {
    return;
  }
  const tile = parseMVT(ab);
  return tile;
};
const defaultPickPointRadius = 5;
const defaultPickLineWidth = 5;

export type TileCoordinates = {
  x: number;
  y: number;
  level: number;
};

export type PointIcon = string | CanvasImageSource;

export type PointIconSize =
  | number
  | {
      width?: number;
      height?: number;
    };

export type Style = {
  fillStyle?: string;
  strokeStyle?: string;
  lineWidth?: number;
  lineJoin?: CanvasLineJoin;
  /** Radius in canvas pixels for point features. */
  pointRadius?: number;
  /** SVG/PNG URL or an already loaded CanvasImageSource for point features. */
  icon?: PointIcon;
  /** Icon width/height. A number produces a square icon; one omitted dimension preserves aspect ratio. */
  iconSize?: PointIconSize;
  /** Normalized icon anchor, where [0.5, 0.5] is centered and [0.5, 1] is bottom-center. */
  iconAnchor?: [number, number];
  /** `crossOrigin` used when loading an icon URL. Defaults to `anonymous`; use null to omit it. */
  iconCrossOrigin?: string | null;
};

type URLTemplate = `${`http${"s" | ""}://` | ""}${string}/{z}/{x}/{y}${string}`;

type FeatureHandler<R> = (feature: VectorTileFeature, tileCoords: TileCoordinates) => R;

export type ImageryProviderOption = {
  urlTemplate: URLTemplate;
  layerName: string;
  headers?: any;
  minimumLevel?: number;
  maximumLevel?: number;
  maximumNativeZoom?: number;
  credit?: string;
  resolution?: number;
  onRenderFeature?: FeatureHandler<boolean | void>;
  onFeaturesRendered?: () => void;
  style?: FeatureHandler<Style>;
  onSelectFeature?: FeatureHandler<ImageryLayerFeatureInfo | void>;
  parseTile?: (url?: string) => Promise<VectorTile | undefined>;
  pickPointRadius?: number | FeatureHandler<number>;
  pickLineWidth?: number | FeatureHandler<number>;
  /** Render points from adjacent tiles so markers can cross tile boundaries. */
  renderPointNeighbors?: boolean;
  /** Maximum marker overflow, in canvas pixels, considered when rendering adjacent tiles. */
  pointRenderBuffer?: number;
};

type ImageryProviderTrait = ImageryProvider;

const CESIUM_CANVAS_SIZE = 256;

export class CesiumMVTImageryProvider implements ImageryProviderTrait {
  // Options
  private readonly _minimumLevel: number;
  private readonly _maximumLevel: number;
  private readonly _urlTemplate: URLTemplate;
  private readonly _layerNames: string[];
  private readonly _credit?: string;
  private readonly _resolution?: number;
  private readonly _headers?: any;
  private _currentUrl?: string;
  private _onRenderFeature?: FeatureHandler<boolean | void>;
  private _onFeaturesRendered?: () => void;
  private _style?: FeatureHandler<Style>;
  private _onSelectFeature?: FeatureHandler<ImageryLayerFeatureInfo | void>;
  private _parseTile: (url?: string, headers?: any) => Promise<VectorTile | undefined>;
  private _pickPointRadius: number | FeatureHandler<number>;
  private _pickLineWidth: number | FeatureHandler<number>;
  private readonly _renderPointNeighbors: boolean;
  private readonly _pointRenderBuffer: number;

  // Internal variables
  private readonly _tilingScheme: WebMercatorTilingScheme;
  private readonly _tileWidth: number;
  private readonly _tileHeight: number;
  private readonly _rectangle: Rectangle;
  private readonly _ready: boolean;
  private readonly _readyPromise: Promise<boolean>;
  private readonly _errorEvent = new CesiumEvent();
  private readonly _tileCaches = new Map<string, VectorTile>();
  private readonly _iconCache = new Map<string, Promise<HTMLImageElement | undefined>>();

  constructor(options: ImageryProviderOption) {
    this._minimumLevel = options.minimumLevel ?? 0;
    this._maximumLevel = options.maximumLevel ?? Infinity;
    this._urlTemplate = options.urlTemplate;
    this._layerNames = options.layerName.split(/, */).filter(Boolean);
    this._credit = options.credit;
    this._resolution = options.resolution ?? 5;
    this._headers = options.headers;
    this._onFeaturesRendered = options.onFeaturesRendered;
    this._onRenderFeature = options.onRenderFeature;
    this._style = options.style;
    this._onSelectFeature = options.onSelectFeature;
    this._parseTile = options.parseTile ?? defaultParseTile;
    this._pickPointRadius = options.pickPointRadius ?? defaultPickPointRadius;
    this._pickLineWidth = options.pickLineWidth ?? defaultPickLineWidth;
    this._renderPointNeighbors = options.renderPointNeighbors ?? false;
    this._pointRenderBuffer = Math.max(0, options.pointRenderBuffer ?? 32);

    this._tilingScheme = new WebMercatorTilingScheme();

    // Maybe these pixels are same with Cesium's tile size.
    this._tileWidth = CESIUM_CANVAS_SIZE;
    this._tileHeight = CESIUM_CANVAS_SIZE;

    this._rectangle = this._tilingScheme.rectangle;
    this._ready = true;
    this._readyPromise = Promise.resolve(true);
  }

  get url() {
    return this._currentUrl;
  }
  get tileWidth() {
    return this._tileWidth;
  }
  get tileHeight() {
    return this._tileHeight;
  }
  // The `requestImage` is called when user zoom the globe.
  // But this invocation is restricted depends on `maximumLevel` or `minimumLevel`.
  get maximumLevel() {
    return this._maximumLevel;
  }
  get minimumLevel() {
    return this._minimumLevel;
  }
  get tilingScheme() {
    return this._tilingScheme;
  }
  get rectangle() {
    return this._rectangle;
  }
  get errorEvent() {
    return this._errorEvent;
  }
  get ready() {
    return this._ready;
  }
  get hasAlphaChannel() {
    return true;
  }
  get credit() {
    return this._credit ? new Credit(this._credit) : <any>undefined;
  }

  // Unused values
  get defaultNightAlpha() {
    return undefined;
  }
  get defaultDayAlpha() {
    return undefined;
  }
  get defaultAlpha() {
    return <any>undefined;
  }
  get defaultBrightness() {
    return <any>undefined;
  }
  get defaultContrast() {
    return <any>undefined;
  }
  get defaultHue() {
    return <any>undefined;
  }
  get defaultSaturation() {
    return <any>undefined;
  }
  get defaultGamma() {
    return <any>undefined;
  }
  get defaultMinificationFilter() {
    return <any>undefined;
  }
  get defaultMagnificationFilter() {
    return <any>undefined;
  }
  get readyPromise() {
    return this._readyPromise;
  }
  get tileDiscardPolicy() {
    return <any>undefined;
  }
  get proxy() {
    return <any>undefined;
  }
  getTileCredits(_x: number, _y: number, _level: number) {
    return [];
  }

  requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request | undefined,
  ): Promise<ImageryTypes> | undefined {
    const canvas = document.createElement("canvas");

    const requestedTile: TileCoordinates = {
      x,
      y,
      level,
    };

    const scaleFactor = (level >= this.maximumLevel ? this._resolution : undefined) ?? 1;
    canvas.width = this._tileWidth * scaleFactor;
    canvas.height = this._tileHeight * scaleFactor;

    this._currentUrl = buildURLWithTileCoordinates(this._urlTemplate, requestedTile);

    return Promise.all(
      this._layerNames.map(n => this._renderCanvas(canvas, requestedTile, n, scaleFactor)),
    ).then(() => canvas);
  }

  async _renderCanvas(
    canvas: HTMLCanvasElement,
    requestedTile: TileCoordinates,
    layerName: string,
    scaleFactor: number,
  ): Promise<HTMLCanvasElement> {
    const tile = await this._cachedTile(
      buildURLWithTileCoordinates(this._urlTemplate, requestedTile),
    );

    const layerNames = layerName.split(/, */).filter(Boolean);
    const layers = layerNames.map(ln => tile?.layers[ln]);

    if (!layers) {
      return canvas;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return canvas;
    }
    context.strokeStyle = "black";
    context.lineWidth = 1;

    // Improve resolution
    context.miterLimit = 2;
    context.setTransform(
      (this._tileWidth * scaleFactor) / CESIUM_CANVAS_SIZE,
      0,
      0,
      (this._tileHeight * scaleFactor) / CESIUM_CANVAS_SIZE,
      0,
      0,
    );

    for (const layer of layers) {
      if (!layer) continue;
      // Vector tile works with extent [0, 4095], but canvas is only [0,255]
      const extentFactor = CESIUM_CANVAS_SIZE / layer.extent;

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);

        // Early return.
        if (this._onRenderFeature && !this._onRenderFeature(feature, requestedTile)) {
          continue;
        }

        const style = this._style?.(feature, requestedTile);
        if (!style) {
          continue;
        }
        context.fillStyle = style.fillStyle ?? context.fillStyle;
        context.strokeStyle = style.strokeStyle ?? context.strokeStyle;
        context.lineWidth = style.lineWidth ?? context.lineWidth;
        context.lineJoin = style.lineJoin ?? context.lineJoin;

        if (VectorTileFeature.types[feature.type] === "Polygon") {
          this._renderPolygon(context, feature, extentFactor, (style.lineWidth ?? 1) > 0);
        } else if (VectorTileFeature.types[feature.type] === "Point") {
          await this._renderPoint(context, feature, extentFactor, style);
        } else if (VectorTileFeature.types[feature.type] === "LineString") {
          this._renderLineString(context, feature, extentFactor);
        } else {
          console.error(
            `Unexpected geometry type: ${feature.type} in region map on tile ${[
              requestedTile.level,
              requestedTile.x,
              requestedTile.y,
            ].join("/")}`,
          );
        }
      }
    }

    if (this._renderPointNeighbors && this._pointRenderBuffer > 0) {
      await this._renderNeighborPoints(context, requestedTile, layerName);
    }

    this._onFeaturesRendered?.();

    return canvas;
  }

  async _renderNeighborPoints(
    context: CanvasRenderingContext2D,
    requestedTile: TileCoordinates,
    layerName: string,
  ): Promise<void> {
    const tileCount = 2 ** requestedTile.level;
    const neighbors = neighborTileCoordinates(requestedTile, tileCount);
    const loadedNeighbors = await Promise.all(
      neighbors.map(async neighbor => ({
        ...neighbor,
        tile: await this._cachedTile(
          buildURLWithTileCoordinates(this._urlTemplate, neighbor.tileCoords),
        ),
      })),
    );

    for (const neighbor of loadedNeighbors) {
      const layer = neighbor.tile?.layers[layerName];
      if (!layer) continue;
      const extentFactor = CESIUM_CANVAS_SIZE / layer.extent;

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (VectorTileFeature.types[feature.type] !== "Point") continue;
        if (this._onRenderFeature && !this._onRenderFeature(feature, neighbor.tileCoords)) {
          continue;
        }

        const style = this._style?.(feature, neighbor.tileCoords);
        if (!style) continue;
        context.fillStyle = style.fillStyle ?? context.fillStyle;
        context.strokeStyle = style.strokeStyle ?? context.strokeStyle;
        context.lineWidth = style.lineWidth ?? context.lineWidth;
        context.lineJoin = style.lineJoin ?? context.lineJoin;

        await this._renderPoint(
          context,
          feature,
          extentFactor,
          style,
          neighbor.offsetX * CESIUM_CANVAS_SIZE,
          neighbor.offsetY * CESIUM_CANVAS_SIZE,
          this._pointRenderBuffer,
        );
      }
    }
  }

  _renderPolygon(
    context: CanvasRenderingContext2D,
    feature: VectorTileFeature,
    extentFactor: number,
    shouldRenderLine: boolean,
  ) {
    context.beginPath();

    const coordinates = feature.loadGeometry();

    // Polygon rings
    for (let i2 = 0; i2 < coordinates.length; i2++) {
      let pos = coordinates[i2][0];
      context.moveTo(pos.x * extentFactor, pos.y * extentFactor);

      // Polygon ring points
      for (let j = 1; j < coordinates[i2].length; j++) {
        pos = coordinates[i2][j];
        context.lineTo(pos.x * extentFactor, pos.y * extentFactor);
      }
    }

    if (shouldRenderLine) {
      context.stroke();
    }
    context.fill();
  }

  async _renderPoint(
    context: CanvasRenderingContext2D,
    feature: VectorTileFeature,
    extentFactor: number,
    style: Style,
    offsetX = 0,
    offsetY = 0,
    renderBuffer?: number,
  ): Promise<void> {
    context.beginPath();

    const coordinates = feature.loadGeometry();

    for (let i2 = 0; i2 < coordinates.length; i2++) {
      const pos = coordinates[i2][0];
      const [x, y] = [pos.x * extentFactor + offsetX, pos.y * extentFactor + offsetY];
      if (
        renderBuffer !== undefined &&
        (x < -renderBuffer ||
          x > CESIUM_CANVAS_SIZE + renderBuffer ||
          y < -renderBuffer ||
          y > CESIUM_CANVAS_SIZE + renderBuffer)
      ) {
        continue;
      }

      const icon = await this._resolveIcon(style.icon, style.iconCrossOrigin);
      if (icon) {
        const [width, height] = iconDimensions(icon, style.iconSize);
        const [anchorX, anchorY] = style.iconAnchor ?? [0.5, 0.5];
        context.drawImage(icon, x - width * anchorX, y - height * anchorY, width, height);
        continue;
      }

      // Keep lineWidth as the fallback radius for backwards compatibility.
      const radius = style.pointRadius ?? context.lineWidth;

      context.beginPath();
      context.arc(x, y, radius, 0, 2 * Math.PI);
      context.fill();
    }
  }

  _resolveIcon(
    icon: PointIcon | undefined,
    crossOrigin: string | null = "anonymous",
  ): Promise<CanvasImageSource | undefined> {
    if (!icon || typeof icon !== "string") {
      return Promise.resolve(icon as CanvasImageSource | undefined);
    }

    const cacheKey = `${crossOrigin ?? ""}:${icon}`;
    const cached = this._iconCache.get(cacheKey);
    if (cached) return cached;

    const loading = new Promise<HTMLImageElement | undefined>(resolve => {
      const image = new Image();
      if (crossOrigin !== null) image.crossOrigin = crossOrigin;
      image.onload = () => resolve(image);
      image.onerror = () => {
        console.warn(`Could not load point icon: ${icon}`);
        resolve(undefined);
      };
      image.src = icon;
    });
    this._iconCache.set(cacheKey, loading);
    return loading;
  }

  _renderLineString(
    context: CanvasRenderingContext2D,
    feature: VectorTileFeature,
    extentFactor: number,
  ) {
    context.beginPath();

    const coordinates = feature.loadGeometry();

    for (let i2 = 0; i2 < coordinates.length; i2++) {
      let pos = coordinates[i2][0];
      context.moveTo(pos.x * extentFactor, pos.y * extentFactor);

      for (let j = 1; j < coordinates[i2].length; j++) {
        pos = coordinates[i2][j];
        context.lineTo(pos.x * extentFactor, pos.y * extentFactor);
      }
    }
    context.stroke();
  }

  async pickFeatures(
    x: number,
    y: number,
    level: number,
    longitude: number,
    latitude: number,
  ): Promise<ImageryLayerFeatureInfo[]> {
    const requestedTile = {
      x: x,
      y: y,
      level: level,
    };

    const url = buildURLWithTileCoordinates(this._urlTemplate, requestedTile);

    const tile = await this._cachedTile(url);

    const ps = await Promise.all(
      this._layerNames.map(async name => {
        const layer = tile?.layers[name];
        if (!layer) {
          return []; // return empty list of features for empty tile
        }
        const f = await this._pickFeatures(requestedTile, longitude, latitude, layer);
        if (f) {
          return f;
        }
        return [];
      }),
    );

    return ps.flat();
  }

  async _pickFeatures(
    requestedTile: TileCoordinates,
    longitude: number,
    latitude: number,
    layer: VectorTileLayer,
  ): Promise<ImageryLayerFeatureInfo[]> {
    const boundRect = this._tilingScheme.tileXYToNativeRectangle(
      requestedTile.x,
      requestedTile.y,
      requestedTile.level,
    );
    const x_range = [boundRect.west, boundRect.east];
    const y_range = [boundRect.north, boundRect.south];

    const map = function (
      pos: Cartesian2,
      in_x_range: number[],
      in_y_range: number[],
      out_x_range: number[],
      out_y_range: number[],
    ) {
      const offset = new Cartesian2();
      // Offset of point from top left corner of bounding box
      Cartesian2.subtract(pos, new Cartesian2(in_x_range[0], in_y_range[0]), offset);
      const scale = new Cartesian2(
        (out_x_range[1] - out_x_range[0]) / (in_x_range[1] - in_x_range[0]),
        (out_y_range[1] - out_y_range[0]) / (in_y_range[1] - in_y_range[0]),
      );
      return Cartesian2.add(
        Cartesian2.multiplyComponents(offset, scale, new Cartesian2()),
        new Cartesian2(out_x_range[0], out_y_range[0]),
        new Cartesian2(),
      );
    };
    const vt_range = [0, layer.extent - 1];
    const pixelScaleX = (vt_range[1] - vt_range[0]) / this._tileWidth;
    // const pixelScaleY = (vt_range[1] - vt_range[0]) / this._tileHeight;
    const pos = map(
      Cartesian2.fromCartesian3(
        this._tilingScheme.projection.project(new Cartographic(longitude, latitude)),
      ),
      x_range,
      y_range,
      vt_range,
      vt_range,
    );
    const point = new Point(pos.x, pos.y);

    const features: ImageryLayerFeatureInfo[] = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (
        (VectorTileFeature.types[feature.type] === "Polygon" &&
          isFeatureClicked(feature.loadGeometry(), point)) ||
        (VectorTileFeature.types[feature.type] === "LineString" &&
          isLineStringClicked(
            feature.loadGeometry(),
            point,
            featureHandlerOrNumber(this._pickLineWidth, feature, requestedTile) * pixelScaleX,
          )) ||
        (VectorTileFeature.types[feature.type] === "Point" &&
          isPointClicked(
            feature.loadGeometry(),
            point,
            featureHandlerOrNumber(this._pickPointRadius, feature, requestedTile) * pixelScaleX,
          ))
      ) {
        if (this._onSelectFeature) {
          const feat = this._onSelectFeature(feature, requestedTile);
          if (feat) {
            features.push(feat);
          }
        }
      }
    }

    return features;
  }

  async _cachedTile(currentUrl: string) {
    if (!currentUrl) return;
    const cachedTile = this._tileCaches.get(currentUrl);
    if (cachedTile) return cachedTile;
    const tile = tileToCacheable(await this._parseTile(currentUrl, this._headers));
    if (tile) this._tileCaches.set(currentUrl, tile);
    return tile;
  }
}

const buildURLWithTileCoordinates = (template: URLTemplate, tile: TileCoordinates) => {
  const decodedTemplate = decodeURIComponent(template);
  const z = decodedTemplate.replace("{z}", String(tile.level));
  const x = z.replace("{x}", String(tile.x));
  const y = x.replace("{y}", String(tile.y));
  return y;
};

const parseMVT = (ab?: ArrayBuffer) => {
  return new VectorTile(new Pbf(ab));
};

const tileToCacheable = (v: VectorTile | undefined) => {
  if (!v) return;
  const layers: VectorTile["layers"] = {};
  for (const [key, value] of Object.entries(v.layers)) {
    const features: VectorTileFeature[] = [];
    const layer = value;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const geo = feature.loadGeometry();
      const bbox = feature.bbox?.();
      const f: VectorTileFeature = {
        ...feature,
        id: feature.id,
        loadGeometry: () => geo,
        bbox: bbox ? () => bbox : undefined,
        toGeoJSON: feature.toGeoJSON,
      };
      features.push(f);
    }
    layers[key] = {
      ...layer,
      feature: i => features[i],
    };
  }
  return { layers };
};

const fetchResourceAsArrayBuffer = (url?: string, headers?: any) => {
  if (!url) {
    throw new Error("fetch request is failed because request url is undefined");
  }

  return Resource.fetchArrayBuffer({ url, headers })?.catch(() => {});
};

function featureHandlerOrNumber(
  f: FeatureHandler<number> | number,
  feature: VectorTileFeature,
  tileCoords: TileCoordinates,
): number {
  if (typeof f === "number") {
    return f;
  }
  return f(feature, tileCoords);
}

function iconDimensions(icon: CanvasImageSource, size?: PointIconSize): [number, number] {
  const source = icon as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: number;
    height?: number;
  };
  const intrinsicWidth = source.naturalWidth ?? source.videoWidth ?? source.width ?? 24;
  const intrinsicHeight = source.naturalHeight ?? source.videoHeight ?? source.height ?? 24;

  if (typeof size === "number") return [size, size];
  if (!size) return [intrinsicWidth, intrinsicHeight];
  if (size.width !== undefined && size.height !== undefined) return [size.width, size.height];
  if (size.width !== undefined) {
    return [size.width, size.width * (intrinsicHeight / intrinsicWidth)];
  }
  if (size.height !== undefined) {
    return [size.height * (intrinsicWidth / intrinsicHeight), size.height];
  }
  return [intrinsicWidth, intrinsicHeight];
}

function neighborTileCoordinates(
  requestedTile: TileCoordinates,
  tileCount: number,
): Array<{ tileCoords: TileCoordinates; offsetX: number; offsetY: number }> {
  const neighbors: Array<{ tileCoords: TileCoordinates; offsetX: number; offsetY: number }> = [];

  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    const y = requestedTile.y + offsetY;
    if (y < 0 || y >= tileCount) continue;

    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (offsetX === 0 && offsetY === 0) continue;
      const unwrappedX = requestedTile.x + offsetX;
      const x = ((unwrappedX % tileCount) + tileCount) % tileCount;
      neighbors.push({
        tileCoords: { x, y, level: requestedTile.level },
        offsetX,
        offsetY,
      });
    }
  }

  return neighbors;
}

export default CesiumMVTImageryProvider;
