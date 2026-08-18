import { CesiumMVTImageryProvider } from "cesium-mvt-imagery-provider";
import { FC, useEffect, useState } from "react";
import { useCesium } from "resium";

export const Imagery: FC = () => {
  const { viewer } = useCesium();
  const [isFeatureSelected, setIsFeatureSelected] = useState<boolean>(false);
  useEffect(() => {
    if (!viewer) return;

    const imageryProvider = new CesiumMVTImageryProvider({
      urlTemplate: "https://martin-dev.atlantis-viz.online/tide_stations/{z}/{x}/{y}",
      layerName: "tide_stations",
      renderPointNeighbors: true,
      pointRenderBuffer: 32,
      onRenderFeature: () => {
        console.log("Before rendering feature");
        return true;
      },
      onFeaturesRendered: () => {
        console.log("After rendering feature");
      },
      style: (_feature, _tileCoords) => {
        const status = String(_feature.properties.source ?? "psmsl");
        const colorByStatus: Record<string, string> = {
          active: "#12b76a",
          warning: "#f79009",
          inactive: "#667085",
        };
        const iconByStatus: Record<string, string> = {
          tide_gauge: "/icons/tide-active.svg",
          psmsl: "/icons/tide-warning.svg",
        };
        const color = isFeatureSelected ? "#f04438" : colorByStatus[status] ?? "#1570ef";

        return {
          strokeStyle: color,
          fillStyle: color,
          lineWidth: 2,
          pointRadius: Number(_feature.properties.radius ?? 6),
          icon: iconByStatus[status] ?? "/icons/tide-default.svg",
          iconSize: Number(_feature.properties.iconSize ?? 28),
          iconAnchor: [0.5, 1],
        };
      },
      onSelectFeature: _feature => {
        setIsFeatureSelected(v => !v);
      },
      credit: "cesium.js",
    });

    const layers = viewer.scene.imageryLayers;
    const currentLayer = layers.addImageryProvider(imageryProvider);
    currentLayer.alpha = 0.5;

    return () => {
      layers.remove(currentLayer);
    };
  }, [viewer, isFeatureSelected]);
  return <div />;
};
