import { buildSplineSurface } from '../track/spline-surface.ts';
import { getSplineTrackFrame, SPLINE_EDITOR_WORLD_SIZE } from '../track/spline.ts';
import type { SplineTrack as TrackLayout } from '../track/spline-records.ts';
import type { VehicleState } from '../simulation/types.ts';

/** Fixed north-up view: +X is right, +Z is down, vehicle heading zero points up. */
export function createMinimap(canvas: HTMLCanvasElement, layout: TrackLayout) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Minimap canvas is unavailable.');
  const background = document.createElement('canvas');
  const mapContext = background.getContext('2d')!;
  const surface = buildSplineSurface(layout);
  const points=surface.polygons.flat(2);
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const span=Math.max(maxX-minX,maxZ-minZ)+12;
  const centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2;
  let size = 1, ratio = 1, scale = 1;
  let latestMarkers: ReadonlyArray<{ state: Readonly<VehicleState>; color: string }> = [];

  function mapPoint(x: number, z: number) {
    return { x: size / 2 + (x - centerX) * scale, y: size / 2 + (z - centerZ) * scale };
  }

  function resize(): void {
    size = Math.max(1, canvas.clientWidth);
    ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = background.width = Math.round(size * ratio);
    canvas.height = background.height = Math.round(size * ratio);
    scale = Math.max(1, size - 20) / span;
    mapContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    mapContext.beginPath();
    for(const polygon of surface.polygons)for(const ring of polygon){
      ring.forEach(([x,z],i)=>{const p=mapPoint(x,z);if(i===0)mapContext.moveTo(p.x,p.y);else mapContext.lineTo(p.x,p.y);});
      mapContext.closePath();
    }
    mapContext.fillStyle='#9eb2bd';mapContext.fill('evenodd');
    for(const marker of [...layout.checkpoints,...(layout.finishLine?[layout.finishLine]:[])]){
      const frame=getSplineTrackFrame(layout,marker);if(!frame)continue;
      const x=(frame.position.x-.5)*SPLINE_EDITOR_WORLD_SIZE,z=(frame.position.y-.5)*SPLINE_EDITOR_WORLD_SIZE;
      const right={x:frame.direction.y,z:-frame.direction.x};
      const a=mapPoint(x-right.x*frame.width/2,z-right.z*frame.width/2),b=mapPoint(x+right.x*frame.width/2,z+right.z*frame.width/2);
      mapContext.beginPath();mapContext.moveTo(a.x,a.y);mapContext.lineTo(b.x,b.y);
      mapContext.strokeStyle=marker===layout.finishLine?'#ffffff':'#45f28a';mapContext.lineWidth=2;mapContext.stroke();
    }
    update(latestMarkers);
  }

  function update(markers: ReadonlyArray<{ state: Readonly<VehicleState>; color: string }>): void {
    latestMarkers = markers;
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context!.clearRect(0, 0, size, size);
    context!.drawImage(background, 0, 0, size, size);
    // Keep each indicator visible if a crash carries a car beyond the map bounds.
    const margin = 9;
    for (const marker of markers) {
      const point = mapPoint(marker.state.position.x, marker.state.position.z);
      context!.save();
      context!.translate(Math.max(margin, Math.min(size - margin, point.x)), Math.max(margin, Math.min(size - margin, point.y)));
      context!.rotate(-marker.state.heading);
      context!.beginPath();
      context!.moveTo(0, -7);
      context!.lineTo(4.5, 4.5);
      context!.lineTo(0, 2.5);
      context!.lineTo(-4.5, 4.5);
      context!.closePath();
      context!.fillStyle = marker.color;
      context!.strokeStyle = '#fff';
      context!.lineWidth = 1.3;
      context!.fill();
      context!.stroke();
      context!.restore();
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  return {
    update,
    dispose(): void {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    },
  };
}
