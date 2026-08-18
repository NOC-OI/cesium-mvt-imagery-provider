import { Cartesian3, Color, Ion } from "cesium";
import { Viewer, Entity } from "resium";

import { Imagery } from "./Imagery";

function App() {
  Ion.defaultAccessToken =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMDNjYzU4OC04NDYzLTRhY2EtYTJiMS02ZmEzOWRhZGU0NTciLCJpZCI6MzYzNzkyLCJpYXQiOjE3NjQwODIzNDh9.45UPeFvrmPkH07McAipCx3df2_dvJWrEUVEKoi_gkSg";
  return (
    <Viewer full>
      <Entity
        name="Tokyo"
        position={Cartesian3.fromDegrees(139.767052, 35.681167, 100)}
        point={{ pixelSize: 10, color: Color.WHITE }}
        description="hoge"
      />
      <Imagery />
    </Viewer>
  );
}

export default App;
