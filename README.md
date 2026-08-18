# cesium-mvt-imagery-provider

## Usage

npm

```
npm i cesium cesium-mvt-imagery-provider
```

```ts
import { Viewer } from "cesium";
import CesiumMVTImageryProvider from "cesium-mvt-imagery-provider";

const imageryProvider = new CesiumMVTImageryProvider({
  urlTemplate: "http://localhost:8080/sample_mvt/{z}/{x}/{y}.mvt",
  layerName: "layerName", // or "layerName1,layerName2,layerName3"
  style: feature => {
    return {
      strokeStyle: "green",
      fillStyle: "green",
      lineWidth: 1,
      pointRadius: 6,
    };
  },
  onSelectFeature: feature => {
    console.log("Feature is selected");
  },
  credit: "cesium.js",
});

const layers = viewer.scene.imageryLayers;
const currentLayer = layers.addImageryProvider(imageryProvider);
currentLayer.alpha = 1;

// Call `layers.remove(currentLayer);` when it is unnecessary.
```

See example directory for more details.

### Install directly from GitHub

Install a tagged version from a public GitHub repository:

```sh
npm install github:YOUR_GITHUB_USERNAME/YOUR_REPOSITORY#v1.6.0
```

Then import the package normally:

```ts
import { CesiumMVTImageryProvider } from "cesium-mvt-imagery-provider";
```

The npm `prepare` lifecycle builds `dist` automatically when installing from Git.
Tags matching `v*` also trigger the release workflow, which verifies that the tag
matches `package.json`, runs lint/type/build checks, packs the package, and attaches
the installable `.tgz` to a GitHub release.

To create version `1.6.0` after committing and pushing the source:

```sh
git tag v1.6.0
git push origin v1.6.0
```

For later releases, update `package.json` and `package-lock.json` first (for example
with `npm version patch`), then push the generated tag. Do not reuse or move an
existing release tag.

### Point markers and data-driven styles

The style callback runs once per feature, so any style can be selected from its MVT
properties. Point features can be drawn as circles with `pointRadius`, or as SVG/PNG
markers with `icon`:

```ts
style: feature => {
  const category = String(feature.properties.category ?? "default");
  const colors: Record<string, string> = {
    park: "#12b76a",
    station: "#1570ef",
  };
  const icons: Record<string, string> = {
    park: "/icons/park.svg",
    station: "/icons/station.png",
  };

  return {
    fillStyle: colors[category] ?? "#667085",
    strokeStyle: colors[category] ?? "#667085",
    lineWidth: 2,
    pointRadius: Number(feature.properties.radius ?? 6),
    icon: icons[category],
    iconSize: Number(feature.properties.iconSize ?? 28),
    iconAnchor: [0.5, 1],
  };
}
```

`icon` accepts a URL or a loaded canvas image source. `iconSize` accepts a square
size or `{ width, height }`; when only one dimension is supplied, the intrinsic aspect
ratio is preserved. URL images are cached and loaded with `crossOrigin = "anonymous"`
by default. Set `iconCrossOrigin: null` to omit that attribute.

### Markers crossing tile boundaries

Canvas imagery is normally clipped at each tile edge. Enable adjacent-tile point
rendering to draw markers from neighboring MVT tiles into the current tile:

```ts
const imageryProvider = new CesiumMVTImageryProvider({
  // ...
  renderPointNeighbors: true,
  pointRenderBuffer: 32,
});
```

Set `pointRenderBuffer` to at least the maximum distance an icon can extend from its
anchor. Adjacent MVT requests use the provider's tile cache, horizontal coordinates
wrap around the globe, and invalid tiles beyond the north/south limits are skipped.
Only point features are rendered from neighboring tiles; lines and polygons are not
duplicated.

## Development

Requires Node.js 20.19+, 22.13+, or 24+ and npm.

1. `npm install`
2. `npm run build`
3. `cd ./example`
4. `npm install && npm run dev`
5. Then example Cesium application is started. The example installs the package from
   the repository root via `file:..`, so it exercises the local built package.

If you run example, you need to set sample MVT data to `./example/public`.
And you should change `layerName` option for `MVTImageryProvider` in `./example/src/Imagery.tsx`.
