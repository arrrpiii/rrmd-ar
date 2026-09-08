import * as THREE from 'three';
import { Rhino3dmLoader } from 'three/addons/loaders/3DMLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type Point = { x: number; y: number };
export type Settings = {
  kind: 'earrings' | 'pendant' | 'single';
  points: Point[];
  size: number;
  rx: number;
  ry: number;
  rz: number;
  finish: 'original' | 'gold' | 'silver' | 'rose';
  exposure: number;
};
export const defaults: Settings = {
  kind: 'earrings',
  points: [
    { x: 0.3, y: 0.48 },
    { x: 0.7, y: 0.48 },
  ],
  size: 14,
  rx: 0,
  ry: 0,
  rz: 0,
  finish: 'original',
  exposure: 1.1,
};
function release(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const v of Object.values(m))
          if (v instanceof THREE.Texture) textures.add(v);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
export async function loadModel(file: File) {
  if (file.size > 80 * 1024 * 1024)
    throw new Error(
      'Choose a model smaller than 80 MB. Simplify a large CAD model before uploading.',
    );
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!['3dm', 'glb', 'stl'].includes(ext || ''))
    throw new Error(
      'Please choose a .3dm, .glb or .stl model. For glTF, export a self-contained GLB.',
    );
  const data = await file.arrayBuffer();
  let root: THREE.Object3D;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      url.startsWith('/vendor/')
    )
      return url;
    throw new Error(
      'This model references external files. Embed its textures in a GLB and try again.',
    );
  });
  if (ext === '3dm') {
    const loader = new Rhino3dmLoader(manager)
      .setLibraryPath('/vendor/rhino/')
      .setWorkerLimit(1);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      root = await new Promise<THREE.Object3D>((resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                'CAD import timed out. Export a simplified GLB or STL and try again.',
              ),
            ),
          60000,
        );
        loader.parse(data, resolve, reject);
      });
      const missing = (root.userData.warnings ?? []).filter(
        (w: { type: string; message: string }) =>
          w.type === 'missing mesh' && /Brep|Extrusion|SubD/.test(w.message),
      ).length;
      if (missing) {
        release(root);
        throw new Error(
          `${missing} CAD objects have no saved render meshes. This would show an incomplete piece. Open the file in Rhino, create render meshes and save, or export a meshed GLB/STL.`,
        );
      }
    } finally {
      clearTimeout(timeout);
      loader.dispose();
    }
  } else if (ext === 'glb') {
    const gltf = await new GLTFLoader(manager).parseAsync(data, '');
    root = gltf.scene;
  } else {
    const geometry = new STLLoader().parse(data);
    geometry.computeVertexNormals();
    root = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: '#d4b26c',
        metalness: 0.85,
        roughness: 0.26,
        side: THREE.DoubleSide,
      }),
    );
  }
  let count = 0,
    triangles = 0;
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      count++;
      triangles +=
        (o.geometry.index?.count ??
          o.geometry.attributes.position?.count ??
          0) / 3;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    } else if (
      o instanceof THREE.Line ||
      o instanceof THREE.Points ||
      o instanceof THREE.Light ||
      o instanceof THREE.Camera
    )
      remove.push(o);
  });
  remove.forEach((o) => o.removeFromParent());
  if (!count) {
    release(root);
    throw new Error(
      'No displayable mesh found. In Rhino, save with render meshes or export a meshed GLB/STL.',
    );
  }
  if (triangles > 3000000) {
    release(root);
    throw new Error(
      'This model has over 3 million triangles. Reduce its mesh detail before trying it on.',
    );
  }
  // Respect CAD hidden layers; bounds include only visible renderable meshes.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverseVisible((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.computeBoundingBox();
      if (o.geometry.boundingBox)
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(max) || max <= 0) {
    release(root);
    throw new Error(
      'The model has no visible geometry. Unhide the jewellery and save again.',
    );
  }
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const normalized = new THREE.Group();
  normalized.add(root);
  normalized.scale.setScalar(1 / max);
  return {
    object: normalized,
    meshes: count,
    triangles: Math.round(triangles),
    ext,
  };
}
export class TryOnRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera();
  environment: THREE.WebGLRenderTarget;
  model: THREE.Object3D | null = null;
  group = new THREE.Group();
  photo: HTMLCanvasElement | null = null;
  materialOverrides: THREE.Material[] = [];
  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment.texture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-2, 3, 5);
    this.scene.add(key, this.group);
  }
  setModel(object: THREE.Object3D) {
    this.group.clear();
    if (this.model) release(this.model);
    this.model = object;
  }
  draw(canvas: HTMLCanvasElement, s: Settings, showJewellery = true) {
    if (!this.photo) return;
    const w = this.photo.width,
      h = this.photo.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.photo, 0, 0);
    this.group.clear();
    this.materialOverrides.forEach((m) => m.dispose());
    this.materialOverrides = [];
    if (!this.model || !showJewellery) return;
    this.renderer.setSize(w, h, false);
    this.renderer.toneMappingExposure = s.exposure;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.near = 0.1;
    this.camera.far = 10000;
    this.camera.position.set(0, 0, 4000);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    for (const p of s.points.slice(0, s.kind === 'earrings' ? 2 : 1)) {
      const instance = this.model.clone(true);
      const orient = new THREE.Group();
      orient.add(instance);
      orient.rotation.set(
        THREE.MathUtils.degToRad(s.rx),
        THREE.MathUtils.degToRad(s.ry),
        THREE.MathUtils.degToRad(s.rz),
      );
      if (s.finish !== 'original') {
        const mat = new THREE.MeshStandardMaterial({
          color: { gold: '#e4bd68', silver: '#dce4ed', rose: '#dca48d' }[
            s.finish
          ],
          metalness: 0.9,
          roughness: 0.23,
          side: THREE.DoubleSide,
        });
        this.materialOverrides.push(mat);
        instance.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = mat;
        });
      }
      orient.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(orient);
      const center = bounds.getCenter(new THREE.Vector3());
      const anchor = new THREE.Group();
      anchor.add(orient);
      orient.position.set(-center.x, -bounds.max.y, -center.z);
      anchor.scale.setScalar((h * s.size) / 100);
      anchor.position.set((p.x - 0.5) * w, (0.5 - p.y) * h, 0);
      this.group.add(anchor);
    }
    this.renderer.render(this.scene, this.camera);
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
  }
  dispose() {
    if (this.model) release(this.model);
    this.materialOverrides.forEach((m) => m.dispose());
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export async function readPhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(
      'Choose a JPG, PNG or WebP photo. Convert HEIC photos to JPG first.',
    );
  if (file.size > 25 * 1024 * 1024)
    throw new Error('Choose a photo smaller than 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth) throw new Error('The photo could not be decoded.');
    const scale = Math.min(
      1,
      1800 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas
      .getContext('2d')!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
