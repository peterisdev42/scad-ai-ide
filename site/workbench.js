/**
 * SCAD AI IDE Pages demo.
 * A REAL Three.js viewport loading a precompiled STL asset.
 * This standalone demo does not run OpenSCAD, VS Code or the extension bridge.
 * Three.js version matches the extension's package.json and is pinned via import map.
 */
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

const demo = document.querySelector('[data-vsc-demo]');
if (demo) {
  const stage = demo.querySelector('[data-vsc-stage]');
  const container = demo.querySelector('[data-vsc-canvas]');
  const status = demo.querySelector('[data-vsc-status]');
  const loading = demo.querySelector('[data-vsc-loading]');
  const displayMode = demo.querySelector('[data-vsc-display-mode]');
  const colorInput = demo.querySelector('[data-vsc-color]');
  const axes = demo.querySelector('[data-vsc-axes]');
  const buttons = new Map([...demo.querySelectorAll('[data-vsc-action]')].map(b => [b.dataset.vscAction, b]));
  let renderer;
  let controls;
  let activeCamera;
  let model;
  let wireframe = false;
  let projection = 'perspective';
  let gridVisible = true;
  let measureMode = false;
  let measurePoints = [];
  let active = true;
  let disposed = false;
  let needsRender = true;
  let frame = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1f1f1f');
  const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
  const orthographic = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 3000);
  perspective.up.set(0, 1, 0);
  orthographic.up.set(0, 1, 0);
  activeCamera = perspective;
  const grid = new THREE.GridHelper(180, 24, '#506072', '#363e49');
  // OpenSCAD models are Z-up. Place the floor grid on the XY plane.
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.16;
  scene.add(grid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.ShadowMaterial({ opacity: 0.15 }));
  ground.position.z = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7585, 2.0));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
  keyLight.position.set(-48, -62, 130);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 300 });
  keyLight.shadow.bias = -0.00012;
  keyLight.shadow.normalBias = 0.03;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xaabde5, 0.65);
  fillLight.position.set(50, 40, 65);
  scene.add(fillLight);
  const measureGroup = new THREE.Group();
  scene.add(measureGroup);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;
  let boundingRadius = 70;
  let boundingCenter = new THREE.Vector3();

  function announce(message) {
    if (status) status.textContent = message;
  }
  function invalidate() { needsRender = true; }
  function updateReadout() {
    if (displayMode) displayMode.textContent = `${projection === 'perspective' ? 'Perspective' : 'Orthographic'} · ${wireframe ? 'Wireframe' : 'Solid'}`;
  }
  function setPressed(action, pressed) {
    const button = buttons.get(action);
    if (button) {
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('is-selected', pressed);
    }
  }
  function clearMeasurements() {
    for (const child of measureGroup.children) {
      child.geometry?.dispose();
      child.material?.dispose();
    }
    measureGroup.clear();
    measurePoints = [];
  }
  function resetView() {
    clearMeasurements();
    const r = boundingRadius;
    const target = boundingCenter;
    perspective.position.copy(target).add(new THREE.Vector3(r * 1.15, -r * 1.5, r * 1.22));
    perspective.up.set(0, 1, 0);
    perspective.lookAt(target);
    orthographic.position.copy(perspective.position);
    orthographic.quaternion.copy(perspective.quaternion);
    orthographic.up.copy(perspective.up);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    announce('Model fitted · drag to orbit, scroll to zoom');
    invalidate();
  }
  function setupControls(camera) {
    const oldTarget = controls ? controls.target.clone() : boundingCenter.clone();
    if (controls) controls.dispose();
    controls = new TrackballControls(camera, renderer.domElement);
    controls.target.copy(oldTarget);
    controls.rotateSpeed = 2.3;
    controls.zoomSpeed = 1.05;
    controls.panSpeed = 0.75;
    controls.staticMoving = true;
    controls.keys = ['', '', ''];
    controls.addEventListener('change', invalidate);
    controls.update();
  }
  function resize() {
    if (!renderer || disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    const halfH = boundingRadius * 1.7;
    orthographic.left = -halfH * aspect;
    orthographic.right = halfH * aspect;
    orthographic.top = halfH;
    orthographic.bottom = -halfH;
    orthographic.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    controls?.handleResize();
    invalidate();
  }
  function setProjection(mode) {
    if (mode === projection || !renderer) return;
    const next = mode === 'orthographic' ? orthographic : perspective;
    const previous = activeCamera;
    next.position.copy(previous.position);
    next.quaternion.copy(previous.quaternion);
    next.up.copy(previous.up);
    activeCamera = next;
    projection = mode;
    setupControls(next);
    resize();
    setPressed('perspective', mode === 'perspective');
    setPressed('orthographic', mode === 'orthographic');
    updateReadout();
    announce(`${mode === 'perspective' ? 'Perspective' : 'Orthographic'} camera selected`);
    invalidate();
  }
  function setMobilePane(pane) {
    if (!['code', 'preview'].includes(pane)) return;
    demo.dataset.mobilePane = pane;
    demo.querySelectorAll('[data-vsc-pane]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.vscPane === pane)));
    if (pane === 'preview') requestAnimationFrame(resize);
  }
  function setWireframe(value) {
    wireframe = Boolean(value);
    if (model) model.material.wireframe = wireframe;
    setPressed('wireframe', wireframe);
    updateReadout();
    announce(wireframe ? 'Actual mesh wireframe enabled' : 'Solid shading enabled');
    invalidate();
  }
  function setGrid(value) {
    gridVisible = Boolean(value);
    grid.visible = gridVisible;
    ground.visible = gridVisible;
    setPressed('grid', gridVisible);
    invalidate();
  }
  function setMeasure(value) {
    measureMode = Boolean(value);
    clearMeasurements();
    setPressed('measure', measureMode);
    setPressed('select', !measureMode);
    if (stage) stage.dataset.tool = measureMode ? 'measure' : 'select';
    announce(measureMode ? 'Measure: click two points on the model' : 'Orbit / Select tool active');
    invalidate();
  }
  function addMarker(point) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(boundingRadius * 0.018, 0.7), 12, 10),
      new THREE.MeshBasicMaterial({ color: '#f98b55', depthTest: false })
    );
    marker.position.copy(point);
    marker.renderOrder = 12;
    measureGroup.add(marker);
  }
  function handleMeasure(event) {
    if (!model || !measureMode || !renderer || !pointerDown) return;
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
    const box = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, activeCamera);
    const hit = raycaster.intersectObject(model, false)[0];
    if (!hit) return;
    if (measurePoints.length === 2) clearMeasurements();
    const at = hit.point.clone();
    measurePoints.push(at);
    addMarker(at);
    if (measurePoints.length === 2) {
      const distance = measurePoints[0].distanceTo(measurePoints[1]);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(measurePoints),
        new THREE.LineBasicMaterial({ color: '#f98b55', depthTest: false })
      );
      line.renderOrder = 11;
      measureGroup.add(line);
      announce(`Point distance: ${distance.toFixed(2)} model units · click for a new measurement`);
    } else {
      announce('Point 1 selected · click another point');
    }
    invalidate();
  }
  function updateAxes() {
    if (!axes) return;
    // Orient the small on-screen labels with the same active camera.
    const q = activeCamera.quaternion.clone().invert();
    const base = [
      ['x', new THREE.Vector3(1, 0, 0)],
      ['y', new THREE.Vector3(0, 1, 0)],
      ['z', new THREE.Vector3(0, 0, 1)]
    ];
    for (const [axis, vec] of base) {
      vec.applyQuaternion(q);
      const element = axes.querySelector('.vsc-axis-' + axis);
      if (element) element.style.transform = `translate(${Math.round(vec.x * 13)}px, ${Math.round(-vec.y * 13)}px)`;
    }
  }
  function frameLoop() {
    if (disposed) return;
    frame = requestAnimationFrame(frameLoop);
    if (!active || document.hidden || !renderer || stage.getBoundingClientRect().width === 0) return;
    controls?.update();
    if (!needsRender) return;
    needsRender = false;
    renderer.render(scene, activeCamera);
    updateAxes();
  }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setClearColor('#1f1f1f');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('vsc-three-canvas');
    setupControls(activeCamera);
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        active = entries[0]?.isIntersecting ?? true;
        invalidate();
      }, { threshold: 0.01 });
      observer.observe(stage);
    }
    renderer.domElement.addEventListener('pointerdown', event => {
      pointerDown = { x: event.clientX, y: event.clientY };
    });
    renderer.domElement.addEventListener('click', handleMeasure);
    stage.addEventListener('dblclick', () => resetView());
    demo.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !demo.contains(button)) return;
      if (button.dataset.vscPane) { setMobilePane(button.dataset.vscPane); return; }
      switch (button.dataset.vscAction) {
        case 'reset': resetView(); break;
        case 'select': setMeasure(false); break;
        case 'measure': setMeasure(!measureMode); break;
        case 'perspective': setProjection('perspective'); break;
        case 'orthographic': setProjection('orthographic'); break;
        case 'grid': setGrid(!gridVisible); break;
        case 'wireframe': setWireframe(!wireframe); break;
      }
    });
    colorInput?.addEventListener('input', event => {
      if (model) model.material.color.set(event.target.value);
      invalidate();
    });
    new STLLoader().load(
      './assets/cheese.stl',
      geometry => {
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const bounds = geometry.boundingBox;
        boundingCenter = bounds.getCenter(new THREE.Vector3());
        boundingRadius = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.52, 30);
        model = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: colorInput?.value ?? '#f9d72c',
          roughness: 0.73,
          metalness: 0,
          side: THREE.DoubleSide
        }));
        model.castShadow = true;
        model.receiveShadow = true;
        scene.add(model);
        resetView();
        resize();
        if (loading) loading.hidden = true;
        announce(`Real STL loaded · ${Math.round(geometry.attributes.position.count / 3).toLocaleString()} triangles`);
        invalidate();
      },
      undefined,
      error => {
        if (loading) loading.textContent = 'Unable to load STL model. Download the file below or refresh.';
        announce('Failed to load cheese.stl');
        console.error('SCAD AI IDE web demo STL failed to load:', error);
      }
    );
    window.addEventListener('pagehide', () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls?.dispose();
      renderer?.dispose();
      model?.geometry.dispose();
      model?.material.dispose();
      clearMeasurements();
    }, { once: true });
    setMobilePane('preview');
    updateReadout();
    frameLoop();
  } catch (error) {
    console.error('SCAD AI IDE interactive demo error:', error);
    if (loading) loading.textContent = '3D preview unavailable in this browser. Download the STL below.';
    announce('WebGL preview unavailable');
  }
}
