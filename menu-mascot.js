import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CONFIG = {
  containerId: 'mascot-widget',
  modelUrl: './glowa.glb',
  desiredHeight: 1.8,
  maxYawLeftDeg: 52,
  maxYawRightDeg: 35,
  maxPitchDeg: 28,
  smoothness: 0.08,
  invertYaw: false,
  invertPitch: false,
  trackingRadiusPx: 650,

  // Pełny obrót 360° przy przejściu między sekcjami
  spinOnSectionChange: true,
  spinDurationSec: 0.9,
  spinDirection: 1,
  continuousScrollSpins: 0,

  // Animacja "różgi" po kliknięciu / tapnięciu (szczególnie na telefonie)
  hornNameMatches: ['rozga', 'różga', 'horn', 'rogi', 'antler', 'twig', 'branch'],
  hornTapRadiusPx: 140,      // Jak blisko środka widgetu trzeba kliknąć/tapnąć
  hornAnimDurationSec: 0.65, // Czas trwania animacji
  hornSwingDeg: 28,          // Maksymalny kąt wychylenia
  hornWiggles: 3             // Liczba wahnięć tam i z powrotem
};

function initMascotWidget() {
  const container = document.getElementById(CONFIG.containerId);
  if (!container) {
    console.warn(`Nie znaleziono kontenera #${CONFIG.containerId}`);
    return;
  }

  const scene = new THREE.Scene();

  const getSize = () => ({
    width: container.clientWidth || 220,
    height: container.clientHeight || 220
  });

  const initialSize = getSize();
  const camera = new THREE.PerspectiveCamera(
    35,
    initialSize.width / initialSize.height,
    0.05,
    500
  );
  camera.position.set(0, 0.1, 4.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(initialSize.width, initialSize.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.4));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2.5, 4, 4);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x9bb8ff, 0.8);
  fillLight.position.set(-3, 1, 2);
  scene.add(fillLight);

  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  scene.add(pivot);

  const maxYawLeft = THREE.MathUtils.degToRad(CONFIG.maxYawLeftDeg);
  const maxYawRight = THREE.MathUtils.degToRad(CONFIG.maxYawRightDeg);
  const maxPitch = THREE.MathUtils.degToRad(CONFIG.maxPitchDeg);
  const hornMaxAngle = THREE.MathUtils.degToRad(CONFIG.hornSwingDeg);

  const pointer = { x: 0, y: 0 };
  const current = { yaw: 0, pitch: 0 };

  let scrollProgress = 0;

  // Element ("różga") znaleziony w modelu
  let hornObj = null;
  const hornBaseQuat = new THREE.Quaternion();
  const hornSwingQuat = new THREE.Quaternion();
  const hornAxisZ = new THREE.Vector3(0, 0, 1);
  const hornAxisX = new THREE.Vector3(1, 0, 0);
  const hornTempQuat = new THREE.Quaternion();

  const hornAnim = {
    active: false,
    elapsed: 0
  };

  const triggerHornAnim = () => {
    if (!hornObj) return;
    hornAnim.active = true;
    hornAnim.elapsed = 0;
  };

  const spinState = {
    active: false,
    elapsed: 0,
    startAngle: 0,
    deltaAngle: 0,
    totalOffset: 0
  };

  const trigger360Spin = (directionSign = 1) => {
    if (!CONFIG.spinOnSectionChange) return;
    spinState.active = true;
    spinState.elapsed = 0;
    spinState.startAngle = spinState.totalOffset;
    spinState.deltaAngle = Math.PI * 2 * CONFIG.spinDirection * directionSign;
  };

  const updateScrollProgress = () => {
    const maxScroll = Math.max(
      document.documentElement.scrollHeight - window.innerHeight,
      1
    );
    scrollProgress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
  };

  const resetPointer = () => {
    pointer.x = 0;
    pointer.y = 0;
  };

  const sections = document.querySelectorAll('main > section');
  if (sections.length > 0 && 'IntersectionObserver' in window) {
    let activeIndex = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]) {
          const nextIndex = Array.from(sections).indexOf(visible[0].target);
          if (activeIndex !== null && nextIndex !== -1 && nextIndex !== activeIndex) {
            const dir = nextIndex > activeIndex ? 1 : -1;
            trigger360Spin(dir);
          }
          activeIndex = nextIndex;
        }
      },
      { threshold: [0.45, 0.7] }
    );

    sections.forEach((sec) => observer.observe(sec));
  }

  const loader = new GLTFLoader();
  loader.load(
    CONFIG.modelUrl,
    (gltf) => {
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const referenceDim = size.y > 0.0001 ? size.y : Math.max(size.x, size.z, 1);
      model.scale.setScalar(CONFIG.desiredHeight / referenceDim);

      const scaledBox = new THREE.Box3().setFromObject(model);
      const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
      model.position.sub(scaledCenter);

      pivot.add(model);

      // Szukamy kości lub siatki pasującej do nazwy "różgi"
      const foundNames = [];
      model.traverse((obj) => {
        if (obj.name) foundNames.push(`${obj.type}:${obj.name}`);
        const lower = (obj.name || '').toLowerCase();
        if (
          !hornObj &&
          CONFIG.hornNameMatches.some((key) => lower.includes(key.toLowerCase()))
        ) {
          hornObj = obj;
          hornBaseQuat.copy(obj.quaternion);
        }
      });

      if (!hornObj) {
        console.warn(
          'Nie znaleziono obiektu/kości dla różgi. Dostępne nazwy w modelu:',
          foundNames
        );
      }
    },
    undefined,
    (err) => {
      console.error('Błąd ładowania pliku .glb:', err);
    }
  );

  window.addEventListener('pointermove', (e) => {
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;

    pointer.x = THREE.MathUtils.clamp(dx / CONFIG.trackingRadiusPx, -1, 1);
    pointer.y = THREE.MathUtils.clamp(-dy / CONFIG.trackingRadiusPx, -1, 1);
  });

  // Reakcja na kliknięcie / tapnięcie w okolicy widgetu (np. na telefonie)
  window.addEventListener('pointerdown', (e) => {
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);

    if (dist <= CONFIG.hornTapRadiusPx) {
      triggerHornAnim();
    }
  });

  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  updateScrollProgress();

  document.addEventListener('mouseleave', resetPointer);
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) {
      resetPointer();
    }
  });
  window.addEventListener('blur', resetPointer);

  window.addEventListener('resize', () => {
    const next = getSize();
    camera.aspect = next.width / next.height;
    camera.updateProjectionMatrix();
    renderer.setSize(next.width, next.height);
    updateScrollProgress();
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (spinState.active) {
      spinState.elapsed += delta;
      const t = Math.min(spinState.elapsed / CONFIG.spinDurationSec, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      spinState.totalOffset = spinState.startAngle + spinState.deltaAngle * ease;

      if (t >= 1) {
        spinState.active = false;
        spinState.totalOffset = spinState.startAngle + spinState.deltaAngle;
      }
    }

    // Animacja "mieszania" / wahania różgi po kliknięciu
    if (hornObj && hornAnim.active) {
      hornAnim.elapsed += delta;
      const t = Math.min(hornAnim.elapsed / CONFIG.hornAnimDurationSec, 1);
      const decay = 1 - t; // Zanikanie drgania pod koniec animacji
      const wave = Math.sin(t * Math.PI * 2 * CONFIG.hornWiggles) * decay;

      hornSwingQuat.setFromAxisAngle(hornAxisZ, wave * hornMaxAngle);
      hornTempQuat.setFromAxisAngle(hornAxisX, wave * hornMaxAngle * 0.45);
      hornSwingQuat.multiply(hornTempQuat);

      hornObj.quaternion.copy(hornBaseQuat).multiply(hornSwingQuat);

      if (t >= 1) {
        hornAnim.active = false;
        hornObj.quaternion.copy(hornBaseQuat);
      }
    }

    const yawSign = CONFIG.invertYaw ? -1 : 1;
    const pitchSign = CONFIG.invertPitch ? -1 : 1;

    const rawYaw = pointer.x * yawSign;
    const yawLimit = rawYaw < 0 ? maxYawLeft : maxYawRight;
    const targetYaw = THREE.MathUtils.clamp(
      rawYaw * yawLimit,
      -maxYawLeft,
      maxYawRight
    );

    const targetPitch = THREE.MathUtils.clamp(
      -pointer.y * maxPitch * pitchSign,
      -maxPitch,
      maxPitch
    );

    current.yaw = THREE.MathUtils.lerp(current.yaw, targetYaw, CONFIG.smoothness);
    current.pitch = THREE.MathUtils.lerp(current.pitch, targetPitch, CONFIG.smoothness);

    const continuousScrollAngle = scrollProgress * Math.PI * 2 * CONFIG.continuousScrollSpins;
    pivot.rotation.y = current.yaw + spinState.totalOffset + continuousScrollAngle;
    pivot.rotation.x = current.pitch;

    renderer.render(scene, camera);
  }

  animate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMascotWidget);
} else {
  initMascotWidget();
}
