import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';

export const PERSEVERANCE_MODEL = 'vendor/models/Perseverance.glb';

/**
 * NASA Mars 2020 Perseverance Rover.
 * Built directly from official NASA Science 3D models (science.nasa.gov/3d-resources).
 *
 * Real Specifications:
 * - Length: 3.0 m, Width: 2.7 m, Height: 2.2 m
 * - Mass: 1025 kg (Earth), 389 kg (Mars 0.38g weight)
 * - Power: MMRTG (Multi-Mission Radioisotope Thermoelectric Generator, ~110 W electrical)
 * - Payload: Mastcam-Z, SuperCam, MOXIE, PIXL, SHERLOC/WATSON, RIMFAX, MEDA
 * - Landing Site: Octavia E. Butler Landing, Jezero Crater (Sol 0, Feb 18 2021)
 */
export class PerseveranceRover {
  constructor(gltf, hf, waypoints, projector) {
    this.hf = hf;
    this.waypoints = waypoints;
    this.projector = projector;
    this.root = new THREE.Group();
    this.root.name = 'PerseveranceRover';
    this.model = gltf.scene;
    this.root.add(this.model);

    // Compute bounding box and adjust wheels to rest flush on terrain surface (y = 0)
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    this.groundOffset = -box.min.y;
    this.model.position.y = this.groundOffset;

    // Materials and shadow casting
    this.model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          o.material.roughness = Math.max(0.25, o.material.roughness || 0.5);
          o.material.envMapIntensity = 1.2;
        }
      }
    });

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.sol = 15;
    this.inspectable = true;
    this.radius = 2.4;

    // Position at authentic site: Sol 15 (WP 2, right along traverse near landing site)
    this.placeAtSol(15);
  }

  static async load(hf, waypoints, projector, url = PERSEVERANCE_MODEL) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
    return new PerseveranceRover(gltf, hf, waypoints, projector);
  }

  /**
   * Place the rover at an authentic waypoint from NASA's mission dataset.
   * @param {number} targetSol Mission Sol to align with
   */
  placeAtSol(targetSol) {
    if (!this.waypoints || !this.waypoints.length) return;
    
    // Find closest waypoint matching targetSol
    let best = this.waypoints[0];
    let minDiff = Infinity;
    for (const f of this.waypoints) {
      const s = f.properties?.sol ?? 0;
      const diff = Math.abs(s - targetSol);
      if (diff < minDiff) {
        minDiff = diff;
        best = f;
      }
    }

    const pr = best.properties;
    const [x, z] = this.projector.lonLatToWorld(pr.lon, pr.lat);
    const y = this.hf.heightAt(x, z);

    this.pos.set(x, y, z);
    this.sol = pr.sol;
    this.root.position.copy(this.pos);

    // Orientation: derive yaw from waypoint telemetry or next waypoint direction
    this.yaw = (pr.yaw_rad != null) ? pr.yaw_rad : (pr.yaw ? pr.yaw * Math.PI / 180 : 0);
    this.root.rotation.y = this.yaw;

    // Align with ground slope for realistic rocker-bogie wheel stance
    const norm = this.hf.normalAt(x, z);
    if (norm) {
      const up = new THREE.Vector3(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, norm);
      this.root.quaternion.copy(q);
      this.root.rotateY(this.yaw);
    }
  }

  /**
   * Check if player is near enough to inspect.
   */
  distanceTo(p) {
    return Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
  }
}
