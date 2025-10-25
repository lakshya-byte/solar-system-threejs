/*
 Overview
 --------
 This file builds an animated solar system scene using three.js. It includes:
 - A textured sun at the origin that emits light (PointLight) and a subtle AmbientLight.
 - Eight planets with approximate sizes, orbital distances, speeds, and axial tilts.
 - Moons that orbit their parent planets using locally stored orbit parameters.
 - Saturn’s ring made of small textured rock meshes, and a large asteroid belt using InstancedMesh.
 - A Tweakpane UI to toggle orbit lines and control a time-scale parameter (reserved for future use).
 - Camera, renderer, orbit controls, and resize handling for a smooth, interactive experience.

 File structure at a glance
 --------------------------
 1) Imports and globals (THREE, OrbitControls, Pane)
 2) Scene & loaders (texture/cube texture) and background
 3) Assets (textures) and materials
 4) Planet data model (array of planet configs)
 5) Helpers: createSaturnRing, createAsteroidBelt, buildPlanetWithTilt, addOrbitLines
 6) Scene assembly: build planets, attach moons, draw orbit lines
 7) UI controls, lights, asteroid belt, Saturn ring
 8) Camera, renderer, controls, clock
 9) Render loop and resize handler
*/

// main.js - Solar System demo using three.js
// Renders the sun, planets with axial tilt, moons, a Saturn ring, and an asteroid belt.
// Includes basic controls, orbit lines toggle, and responsive sizing.
import * as THREE from 'three'; // Core 3D library
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js'; // Mouse/touch navigation helper
import {Pane} from 'tweakpane'; // UI library for simple controls
import {Text} from 'troika-three-text';

// Safety patch: Provide no-op setters for Troika Text depth materials to avoid
// TypeError when any external code tries to assign them. Troika defines these
// as getter-only properties; assigning would otherwise throw at runtime.
try {
    const descDepth = Object.getOwnPropertyDescriptor(Text.prototype, 'customDepthMaterial');
    if (descDepth && !descDepth.set) {
        Object.defineProperty(Text.prototype, 'customDepthMaterial', {
            get: descDepth.get,
            set: function (_) { /* no-op to avoid TypeError on external assignment */
            },
            configurable: true
        });
    }
    const descDist = Object.getOwnPropertyDescriptor(Text.prototype, 'customDistanceMaterial');
    if (descDist && !descDist.set) {
        Object.defineProperty(Text.prototype, 'customDistanceMaterial', {
            get: descDist.get,
            set: function (_) { /* no-op */
            },
            configurable: true
        });
    }
} catch (e) {
    console.warn('Troika Text depth material patch failed:', e);
}


/*
 Section: UI Pane
 ----------------
 Creates a single Tweakpane instance used for toggles/sliders. We keep one global pane
 to avoid duplicate UI when this module hot-reloads in dev.
*/
// UI pane for simple runtime controls (Tweakpane)
const pane = new Pane(); // root UI panel

/*
 Section: UI Controls (Tweakpane)
 -------------------------------
 We expose two controls:
 - showOrbits: toggles visibility of all orbit LineLoops stored in scene.userData.orbits.
 - timeScale: reserved multiplier for animation speed (currently not wired in; kept for future use).
*/
// Orbit toggle + Time control
const params = {
    showOrbits: true, // initial visibility state for orbit lines
    timeScale: 1.0 // default normal speed
};

// Create a folder in Tweakpane to group related controls
const folder = pane.addFolder({title: 'Display Controls', expanded: true});

// Orbit visibility toggle — update all orbit lines on change
folder.addBinding(params, 'showOrbits', {label: 'Show Orbits'}).on('change', (ev) => {
    const visible = ev.value; // boolean
    scene.userData.orbits.forEach((orbit) => (orbit.visible = visible)); // show/hide each
});

// Time scale slider — added once, outside the toggle handler
if (folder.addInput) {
    folder.addInput(params, 'timeScale', {label: 'Time Scale', min: 0, max: 100, step: 1}); // Tweakpane v4
} else {
    folder.addBinding(params, 'timeScale', {label: 'Time Scale', min: 0, max: 100, step: 1}); // Tweakpane v3 fallback
}

// --- Space Dust: params ---
params.spaceDustEnabled = true;
params.spaceDustCount = 800;     // 300–1200 depending on perf
params.spaceDustSpeed = 0.6;     // units/sec toward camera
params.spaceDustSize = 1.5;      // point size
params.spaceDustSpread = 40;     // x/y spread around view
params.spaceDustMinScale = 0.05;   // smallest pebble
params.spaceDustMaxScale = 0.22;   // largest pebble
params.spaceDustRotSpeed = 1.2;    // avg spin (rad/sec), randomized per pebble


// --- Space Dust: UI controls ---
if (folder.addInput) {
    folder.addInput(params, 'spaceDustEnabled', {label: 'Space Dust'});
    folder.addInput(params, 'spaceDustCount', {label: 'Dust Count', min: 100, max: 2000, step: 50});
    folder.addInput(params, 'spaceDustSpeed', {label: 'Dust Speed', min: 0, max: 5, step: 0.01});
    folder.addInput(params, 'spaceDustSize', {label: 'Dust Size', min: 0.1, max: 6, step: 0.1});
    folder.addInput(params, 'spaceDustSpread', {label: 'Dust Spread', min: 5, max: 120, step: 1});
} else {
    folder.addBinding(params, 'spaceDustEnabled', {label: 'Space Dust'});
    folder.addBinding(params, 'spaceDustCount', {label: 'Dust Count', min: 100, max: 2000, step: 50});
    folder.addBinding(params, 'spaceDustSpeed', {label: 'Dust Speed', min: 0, max: 5, step: 0.01});
    folder.addBinding(params, 'spaceDustSize', {label: 'Dust Size', min: 0.1, max: 6, step: 0.1});
    folder.addBinding(params, 'spaceDustSpread', {label: 'Dust Spread', min: 5, max: 120, step: 1});
}

// params (put near your other pane params)
params.labelsEnabled = true;
params.labelSize = 0.6;  // text size in scene units

// UI (add to your existing folder)
if (folder.addInput) {
    folder.addInput(params, 'labelsEnabled', {label: 'Planet Labels'});
    folder.addInput(params, 'labelSize', {label: 'Label Size', min: 0.2, max: 3, step: 0.1});
} else {
    folder.addBinding(params, 'labelsEnabled', {label: 'Planet Labels'});
    folder.addBinding(params, 'labelSize', {label: 'Label Size', min: 0.2, max: 3, step: 0.1});
}


/*
 Section: Scene and Loaders
 -------------------------
 Create the root THREE.Scene and the texture loaders. The CubeTextureLoader is used for
 the starfield background; TextureLoader is used for planet/sun/rock textures.
*/
// THREE.js scene graph root
const scene = new THREE.Scene(); // acts as the parent for all objects in the world

// Texture loaders for 2D textures and cubemap backgrounds
const textureLoader = new THREE.TextureLoader(); // loads JPG/PNG textures
const cubeTextureLoader = new THREE.CubeTextureLoader(); // loads 6 faces for skybox-like backgrounds
// Note: For Vite, reference each face via new URL so assets are correctly resolved

/*
 Section: Textures
 -----------------
 All textures are loaded using Vite-friendly absolute URLs resolved via new URL(..., import.meta.url).
 This ensures correct paths in both dev and production builds.
*/
// Load planet/sun/rock textures (Vite-friendly URLs via new URL(..., import.meta.url))
const sunTexture = textureLoader.load(new URL('../static/textures/8k_sun.jpg', import.meta.url).href); // sun surface
const mercuryTexture = textureLoader.load(new URL('../static/textures/8k_mercury.jpg', import.meta.url).href); // Mercury albedo
const venusTexture = textureLoader.load(new URL('../static/textures/8k_venus_surface.jpg', import.meta.url).href); // Venus surface
const earthTexture = textureLoader.load(new URL('../static/textures/8k_earth_daymap.jpg', import.meta.url).href); // Earth day map
const marsTexture = textureLoader.load(new URL('../static/textures/8k_mars.jpg', import.meta.url).href); // Mars albedo
const jupiterTexture = textureLoader.load(new URL('../static/textures/8k_jupiter.jpg', import.meta.url).href); // Jupiter bands
const saturnTexture = textureLoader.load(new URL('../static/textures/8k_saturn.jpg', import.meta.url).href); // Saturn texture
const uranusTexture = textureLoader.load(new URL('../static/textures/2k_uranus.jpg', import.meta.url).href); // Uranus
const neptuneTexture = textureLoader.load(new URL('../static/textures/2k_neptune.jpg', import.meta.url).href); // Neptune
const moonTexture = textureLoader.load(new URL('../static/textures/8k_moon.jpg', import.meta.url).href); // Earth moon
const rockTexture = textureLoader.load(new URL('../static/textures/rock_tile_floor_disp_4k.png', import.meta.url).href); // generic rock for ring
const asteroidTexture = textureLoader.load(new URL('../static/textures/4k_makemake_fictional.jpg', import.meta.url).href); // asteroid albedo
// Using troika-three-text for labels (no font asset needed); labels will be created after planets are built.

/*
 Section: Background (Cubemap)
 ----------------------------
 Load a 6-face starfield cubemap and assign it to scene.background. This gives a space backdrop
 without modeling distant geometry. The loader accepts an array of 6 URLs in the order px, nx, py, ny, pz, nz.
*/
// Load a starfield-style cubemap for the scene background
const backgroundCubeMap = cubeTextureLoader.load(
    [
        new URL('../static/textures/cubemap/px.png', import.meta.url).href, // +X face (right)
        new URL('../static/textures/cubemap/nx.png', import.meta.url).href,  // -X face (left)
        new URL('../static/textures/cubemap/py.png', import.meta.url).href,   // +Y face (top)
        new URL('../static/textures/cubemap/ny.png', import.meta.url).href,   // -Y face (bottom)
        new URL('../static/textures/cubemap/pz.png', import.meta.url).href, // +Z face (front)
        new URL('../static/textures/cubemap/nz.png', import.meta.url).href   // -Z face (back)
    ],
    () => {
        console.log('Cubemap loaded'); // success callback
    },
    undefined, // progress callback (unused)
    (err) => {
        console.error('Failed to load cubemap', err); // error callback
    }
);

scene.background = backgroundCubeMap;

/*
 Section: Sun (Emitter) and Base Sphere Geometry
 ----------------------------------------------
 We create a high-segment sphere geometry we can reuse, and a MeshBasicMaterial for the sun
 (unlit material because the sun is a light source itself). The sun sits at the origin.
*/
// Sun (big yellow sphere)
const sphereGeometry = new THREE.SphereGeometry(1, 64, 64); // reusable sphere (unit radius)
const sunMaterial = new THREE.MeshBasicMaterial({
    map: sunTexture // emissive look via texture; BasicMaterial ignores lights
});
const sun = new THREE.Mesh(sphereGeometry, sunMaterial); // mesh = geometry + material
sun.scale.setScalar(5); // scale up to represent the star
scene.add(sun); // add to scene so it renders


/*
 Section: Materials
 ------------------
 Physically-based MeshStandardMaterial is used for all planets and moons so they react to
 lights (Ambient + Point light at the sun). Each material maps a texture to the sphere.
*/
// Planet surface materials
const mercuryMaterial = new THREE.MeshStandardMaterial({map: mercuryTexture})
const venusMaterial = new THREE.MeshStandardMaterial({map: venusTexture})
const earthMaterial = new THREE.MeshStandardMaterial({map: earthTexture})
const marsMaterial = new THREE.MeshStandardMaterial({map: marsTexture})
const jupiterMaterial = new THREE.MeshStandardMaterial({map: jupiterTexture})
const saturnMaterial = new THREE.MeshStandardMaterial({map: saturnTexture})
const uranusMaterial = new THREE.MeshStandardMaterial({map: uranusTexture})
const neptuneMaterial = new THREE.MeshStandardMaterial({map: neptuneTexture})

// Moon material (shared)
const moonMaterial = new THREE.MeshStandardMaterial({map: moonTexture})


/*
 Section: Planet Data Model
 -------------------------
 The following array defines each planet's visual radius, orbital distance from the sun,
 orbital angular speed, axial tilt in degrees, material, and a list of moons.
 Notes:
 - Values are artistically chosen for readability, not astrophysical accuracy.
 - Distances and sizes are in arbitrary scene units but stay consistent across the file.
*/
// visually balanced (not astronomically precise) — paste in place of your current planets array
const planets = [
    {
        name: "Mercury",
        radius: 0.40,        // visible but small
        distance: 8,         // outside sun (sun ~5)
        speed: 0.02076050,
        tilt: 0.034,         // very slight tilt (~0.03°)
        material: mercuryMaterial,
        moons: []
    },
    {
        name: "Venus",
        radius: 0.95,
        distance: 12,
        speed: 0.00812760,
        tilt: 177.3,         // retrograde rotation (spins backwards)
        material: venusMaterial,
        moons: []
    },
    {
        name: "Earth",
        radius: 1.0,
        distance: 18,
        speed: 0.005,
        tilt: 23.5,          // 23.5° axial tilt
        material: earthMaterial,
        moons: [
            {name: "Moon", radius: 0.27, distance: 2.5, speed: 0.015}
        ]
    },
    {
        name: "Mars",
        radius: 0.55,
        distance: 25,
        speed: 0.00281185,
        tilt: 25.2,          // similar to Earth’s tilt
        material: marsMaterial,
        moons: [
            {name: "Phobos", radius: 0.03, distance: 1.1, speed: 1.28473354},
            {name: "Deimos", radius: 0.02, distance: 1.6, speed: 0.32448931}
        ]
    },
    {
        name: "Jupiter",
        radius: 5.2,
        distance: 40,
        speed: 0.00042144,
        tilt: 3.1,           // almost upright
        material: jupiterMaterial,
        moons: [
            {name: "Io", radius: 0.29, distance: 3.2, speed: 0.02306162},
            {name: "Europa", radius: 0.25, distance: 4.5, speed: 0.01155051},
            {name: "Ganymede", radius: 0.42, distance: 6.5, speed: 0.00322284},
            {name: "Callisto", radius: 0.38, distance: 9.0, speed: 0.00134651}
        ]
    },
    {
        name: "Saturn",
        radius: 4.6,
        distance: 58,
        speed: 0.00016964,
        tilt: 26.7,          // noticeable tilt
        material: saturnMaterial,
        moons: [
            {name: "Titan", radius: 0.40, distance: 4.0, speed: 0.00128921},
            {name: "Rhea", radius: 0.12, distance: 2.4, speed: 0.00361402}
        ]
    },
    {
        name: "Uranus",
        radius: 2.0,
        distance: 78,
        speed: 0.0000595,
        tilt: 97.8,          // rolls sideways (retrograde)
        material: uranusMaterial,
        moons: [
            {name: "Titania", radius: 0.125, distance: 2.8, speed: 0.04707443},
            {name: "Oberon", radius: 0.12, distance: 4.2, speed: 0.03044121}
        ]
    },
    {
        name: "Neptune",
        radius: 1.95,
        distance: 98,
        speed: 0.0000303,
        tilt: 28.3,          // moderate tilt
        material: neptuneMaterial,
        moons: [
            {name: "Triton", radius: 0.21, distance: 3.0, speed: 0.06973456}
        ]
    }
];


/**
 * Create Saturn's ring as a group of many small rock meshes around the given planet mesh.
 * The ring is slightly tilted and attached to the planet so it follows its orbit and tilt.
 * @param {THREE.Mesh} saturnMesh - The planet mesh to attach the ring to (assumed to be Saturn).
 * @returns {THREE.Group} A group containing all ring asteroid meshes.
 */
const createSaturnRing = (saturnMesh) => {
    const ringGroup = new THREE.Group();
    const asteroidGeo = new THREE.SphereGeometry(0.15, 6, 6);
    const asteroidMat = new THREE.MeshStandardMaterial({
        map: rockTexture,
        roughness: 0.9,
    });

    const innerRadius = saturnMesh.scale.x * 0.3;
    const outerRadius = saturnMesh.scale.x * 0.55;

    for (let i = 0; i < 700; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
        const y = (Math.random() - 0.5) * 0.5; // small vertical scatter

        const asteroid = new THREE.Mesh(asteroidGeo, asteroidMat);
        asteroid.position.set(
            Math.cos(angle) * radius,
            y,
            Math.sin(angle) * radius
        );
        asteroid.scale.setScalar(0.1 + Math.random() * 0.3);
        ringGroup.add(asteroid);
    }

    ringGroup.rotation.x = THREE.MathUtils.degToRad(12); // tilt for realism
    saturnMesh.add(ringGroup);
    return ringGroup;
}

/**
 * Create a broad asteroid belt around the origin (the Sun) using InstancedMesh for performance.
 * Each instance is a low‑poly rock with random position, rotation, and scale between inner/outer radii.
 * @param {THREE.Scene} scene - Scene to add the belt to.
 * @param {{innerRadius?:number, outerRadius?:number, thickness?:number, count?:number, minScale?:number, maxScale?:number}} [options]
 * @returns {THREE.InstancedMesh} The instanced mesh representing the asteroid belt.
 */
const createAsteroidBelt = (scene, options = {}) => {
    const {
        innerRadius = 28,     // just outside Mars (Mars ~25)
        outerRadius = 36,     // just inside Jupiter (Jupiter ~40)
        thickness = 2.0,      // vertical thickness
        count = 2000,         // number of asteroids
        minScale = 0.05,
        maxScale = 0.25,
        color = 0x8b7d6b
    } = options;

    // cheap rock geometry
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
        map: asteroidTexture,
        roughness: 0.95,
        metalness: 0.03
    });

    const instanced = new THREE.InstancedMesh(rockGeo, rockMat, count);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        // uniform in area between inner and outer: sample r^2 uniformly
        const u = Math.random();
        const r = Math.sqrt(u * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);

        // small eccentricity and vertical offset
        const ecc = (Math.random() - 0.5) * (outerRadius - innerRadius) * 0.03;
        const x = Math.cos(angle) * (r + ecc);
        const z = Math.sin(angle) * (r + ecc);
        const y = (Math.random() - 0.5) * thickness;

        const s = minScale + Math.random() * (maxScale - minScale);

        dummy.position.set(x, y, z);
        dummy.scale.setScalar(s);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.updateMatrix();
        instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;

    // slight tilt so belt isn't perfectly flat
    instanced.rotation.x = THREE.MathUtils.degToRad(2);

    scene.add(instanced);
    return instanced;
}

// --- Space Dust: create near-camera points ---
// === createSpacePebbles(camera, opts) ===
// Near-camera floating rocks using InstancedMesh (fast + 3D look).
const createSpacePebbles = (camera, opts = {}) => {
    const count = opts.count ?? params.spaceDustCount;
    const spread = opts.spread ?? params.spaceDustSpread; // x/y box half-extent * 2
    const near = opts.near ?? 2;   // closest z (camera space, positive forward means we place at negative)
    const far = opts.far ?? 60;  // farthest z (more negative)
    const sMin = opts.minScale ?? params.spaceDustMinScale;
    const sMax = opts.maxScale ?? params.spaceDustMaxScale;

    // Low-poly rock geometry; textured with your asteroidTexture
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
        map: rockTexture,       // <-- your texture from code
        roughness: 0.95,
        metalness: 0.03
    });

    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Per-instance state we’ll update each frame
    const pos = new Array(count);          // THREE.Vector3 for camera-local position
    const scale = new Array(count);        // number (uniform scale)
    const rotAxis = new Array(count);      // THREE.Vector3 axis
    const rotSpeed = new Array(count);     // number (rad/sec)
    const rotAngle = new Float32Array(count);

    const rnd = (a, b) => a + Math.random() * (b - a);

    for (let i = 0; i < count; i++) {
        pos[i] = new THREE.Vector3(
            rnd(-spread * 0.5, spread * 0.5),
            rnd(-spread * 0.5, spread * 0.5),
            -near - Math.random() * (far - near)   // negative z = in front of camera
        );
        scale[i] = rnd(sMin, sMax);
        rotAxis[i] = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
        rotSpeed[i] = rnd(0.3, params.spaceDustRotSpeed || 1.2);
        rotAngle[i] = Math.random() * Math.PI * 2;

        const dummy = new THREE.Object3D();
        dummy.position.copy(pos[i]);
        dummy.quaternion.setFromAxisAngle(rotAxis[i], rotAngle[i]);
        dummy.scale.set(scale[i], scale[i], scale[i]);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
    }

    // Parent to camera so they feel "near"
    camera.add(inst);

    return {
        inst, pos, scale, rotAxis, rotSpeed, rotAngle,
        spread, near, far, sMin, sMax,
        dispose: () => {
            camera.remove(inst);
            geo.dispose();
            mat.dispose();
        }
    };
};


/**
 * Build a planet with an orbital parent and an axial-tilt group.
 * Structure: orbitGroup (rotates around sun) -> tiltGroup (leans by tilt) -> planet mesh
 * @param {{name:string,radius:number,distance:number,speed:number,tilt:number,material:THREE.Material}} planetData
 * @returns {{orbitGroup:THREE.Group, tiltGroup:THREE.Group, mesh:THREE.Mesh}}
 */
const buildPlanetWithTilt = (planetData) => {
    // orbitGroup sits at origin and will be rotated to orbit the sun
    const orbitGroup = new THREE.Group();
    orbitGroup.name = `${planetData.name}-orbit`;

    // tiltGroup is rotated to represent axial tilt (tilt applied around local X or Z)
    // we rotate around Z so tilt axis leans relative to orbital plane (Y up).
    const tiltGroup = new THREE.Group();
    tiltGroup.name = `${planetData.name}-tilt`;
    // convert degrees to radians and apply tilt on Z (lean forward/back)
    const tiltRad = (planetData.tilt || 0) * Math.PI / 180;
    tiltGroup.rotation.z = tiltRad;

    // planet mesh as unit sphere scaled to radius
    // use appropriate segments depending on size (optional)
    const segments = planetData.radius > 3 ? 64 : (planetData.radius > 1 ? 32 : 16);
    const geo = new THREE.SphereGeometry(1, segments, segments);
    const mat = planetData.material || new THREE.MeshStandardMaterial({color: 0x888888});
    const planetMesh = new THREE.Mesh(geo, mat);
    planetMesh.name = planetData.name;
    planetMesh.position.set(planetData.distance, 0, 0); // place planet along +X
    planetMesh.scale.setScalar(planetData.radius);

    // structure: orbitGroup -> tiltGroup -> planetMesh
    tiltGroup.add(planetMesh);
    orbitGroup.add(tiltGroup);


    // return references to add to scene and animate later
    return {orbitGroup, tiltGroup, mesh: planetMesh};
}

/*
 Section: Scene Assembly (Planets and Moons)
 -----------------------------------------
 We instantiate each planet using buildPlanetWithTilt(), attach the orbitGroup to the scene,
 and keep references in arrays for animation. Then we attach each planet's moons to the planet
 mesh (under its tilt group) and store per-moon orbit data on the mesh to make animation safe.
*/
// after defining planets array
const created = []; // store for animation & interaction
const planetMeshes = []; // flat list to reference specific planet meshes by index/name

// build planets with tilt and add to scene
planets.forEach((p) => {
    const built = buildPlanetWithTilt(p); // { orbitGroup, tiltGroup, mesh }
    scene.add(built.orbitGroup); // top-level parent that will rotate around the sun
    created.push({data: p, orbit: built.orbitGroup, tilt: built.tiltGroup, mesh: built.mesh});
    planetMeshes.push(built.mesh); // preserve direct access to the final planet mesh
});

// attach moons to each planet mesh (so they orbit around the tilted planet axis)
created.forEach((obj) => {
    const p = obj.data; // planet data config
    if (Array.isArray(p.moons)) {
        p.moons.forEach((m) => {
            const moonGeo = new THREE.SphereGeometry(1, 12, 12); // low-poly moon is fine
            const moonMat = moonMaterial || new THREE.MeshStandardMaterial({color: 0x999999});
            const moonMesh = new THREE.Mesh(moonGeo, moonMat);
            moonMesh.scale.setScalar(m.radius); // visual moon radius
            moonMesh.position.set(m.distance, 0, 0); // placed relative to planet (local X)

            // mark as moon and store local orbit params so animation is robust
            moonMesh.userData.isMoon = true; // used to filter children in render loop
            moonMesh.userData.orbit = {
                distance: m.distance, // orbital radius around the planet
                speed: m.speed,       // angular speed (radians per second-ish)
                angle: Math.random() * Math.PI * 2 // start offset so moons don't align
            };

            obj.mesh.add(moonMesh); // parent moon to the planet mesh (under tilt)
        });
    }
});

/**
 * Create simple circular orbit lines for visual reference, one per planet.
 * Attaches each line to the corresponding tilt group so the line inherits tilt.
 * Populates scene.userData.orbits for UI toggling.
 * @param {{data:any, tilt:THREE.Group}[]} createdList
 */
const addOrbitLines = (createdList) => {
    scene.userData.orbits = [];
    createdList.forEach((obj) => {
        const curve = new THREE.EllipseCurve(0, 0, obj.data.distance, obj.data.distance, 0, 2 * Math.PI);
        const points = curve.getPoints(240);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.35});
        const orbit = new THREE.LineLoop(geometry, material);
        // make orbit lie on XZ plane relative to its parent
        orbit.rotation.x = Math.PI / 2;
        obj.tilt.add(orbit);
        scene.userData.orbits.push(orbit);
    });
};

// add orbit lines now that planets exist
addOrbitLines(created);


// Create a single label using troika-three-text (billboard-ready)
const makeLabelMesh = (labelText, size, color = 0xffffff) => {
    const text = new Text();
    text.text = labelText;
    text.fontSize = size;
    text.color = color;
    // center horizontally, keep baseline vertically
    text.anchorX = 'center';
    text.anchorY = 'baseline';
    // improve readability slightly
    text.outlineWidth = 0.0; // set >0 for halo
    text.depthOffset = -1; // bias to reduce z-fighting when overlapping
    // ensure late render so most scene depth exists
    text.renderOrder = 999;
    // Avoid shadow depth overrides: Troika's Text defines getter-only customDepthMaterial/customDistanceMaterial
    // Some generic code may try to set these when castShadow is true; keep shadows off for labels
    text.castShadow = false;
    text.receiveShadow = false;
    // material depth settings
    // troika creates its own material; tweak after creation
    text.sync(() => {
        if (text.material) {
            text.material.depthWrite = false;
            // Choose visibility policy: keep physical occlusion (true) or always on top (false)
            text.material.depthTest = true;
            text.material.toneMapped = false;
        }
    });
    return text;
};

// Add labels for each planet (created[i] = { data, orbit, tilt, mesh })
const addPlanetLabels = (createdList) => {
    // clean old
    removePlanetLabels();

    const group = new THREE.Group();
    group.name = 'PlanetLabelsGroup';

    createdList.forEach(obj => {
        const name = obj.data.name;
        const size = params.labelSize || 0.6;
        const label = makeLabelMesh(name, size);

        // anchor: attach to planet mesh but offset so it "floats" above/right of planet
        const anchor = new THREE.Object3D();
        // offset by planet radius so it clears the sphere; tweak multipliers to taste
        const r = obj.data.radius;
        anchor.position.set(r * 1.2, r * 0.9, 0);
        obj.mesh.add(anchor);
        anchor.add(label);

        // keep for updates/disposal
        if (!scene.userData._labels) scene.userData._labels = [];
        scene.userData._labels.push({anchor, label, planetObj: obj});
    });

    scene.add(group); // (optional holder; labels are parented to planets)
    scene.userData.labelsGroup = group;
};

// Remove all labels (e.g., before rebuild)
const removePlanetLabels = () => {
    const rec = scene.userData._labels;
    if (rec) {
        rec.forEach(({label}) => {
            if (label.geometry) label.geometry.dispose();
            if (label.material) label.material.dispose();
            if (label.parent) label.parent.remove(label);
        });
    }
    scene.userData._labels = [];
    if (scene.userData.labelsGroup) {
        scene.remove(scene.userData.labelsGroup);
        scene.userData.labelsGroup = null;
    }
};


// when you finish building planets:
scene.userData.createdPlanets = created; // save your existing 'created' array

// Build labels now that planets exist (troika text doesn't need font loading)
addPlanetLabels(created);

/*
 Section: Lighting
 -----------------
 We use a dim ambient light so the night sides are not completely black, and a very bright
 point light at the origin to simulate the sun’s illumination.
*/
// Subtle ambient and strong point light (sunlight) at the origin
const ambientLight = new THREE.AmbientLight(0xffffff, 0.1); // low-intensity fill
scene.add(ambientLight); // add to scene

const pointLight = new THREE.PointLight(0xffffff, 6000); // bright point light at (0,0,0)
scene.add(pointLight); // acts like the sun

/*
 Section: Asteroid Belt and Saturn Ring
 -------------------------------------
 Create a performant instanced asteroid belt between Mars and Jupiter, then locate Saturn’s
 mesh and attach a rock-textured ring group to it.
*/
// after you build the planets (planetMesh array exists)
const belt = createAsteroidBelt(scene, {
    innerRadius: 28, // inner radius of belt
    outerRadius: 33, // outer radius of belt
    thickness: 2.0,  // vertical spread
    count: 2000,      // reduce to 800-1200 on low-end devices
    minScale: 0.04,
    maxScale: 0.18
});
// optional: keep reference for future control
scene.userData.asteroidBelt = belt; // stored on scene for animation


// Find Saturn and add ring
const saturnIndex = planets.findIndex(p => p.name === "Saturn"); // locate Saturn in data
if (saturnIndex !== -1) {
    const saturnMesh = planetMeshes[saturnIndex]; // corresponding mesh
    if (saturnMesh) {
        const saturnRing = createSaturnRing(saturnMesh); // build ring
        saturnMesh.userData.ring = saturnRing; // keep a reference for animation
    }
}

/*
 Section: Camera Setup
 ---------------------
 Use a PerspectiveCamera with a comfortable FOV and a far plane large enough to include
 the outer planets. Point the camera at the origin where the sun resides.
*/
// Camera: perspective with a comfortable FOV and far plane large enough for outer planets
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 20, 100); // pull back and slightly above the ecliptic
camera.lookAt(0, 0, 0); // focus the sun

scene.add(camera);


/*
 Section: Renderer and Canvas
 ---------------------------
 Acquire the canvas element and create a WebGLRenderer bound to it. Antialiasing smooths edges,
 setPixelRatio caps device pixel ratio for performance, and ACES tone mapping provides a nice
 HDR response even if we mostly use LDR textures here.
*/
// Renderer: ties to the <canvas id="canvas"> element and enables antialiasing
const canvas = document.querySelector('#canvas'); // <canvas> from index.html
if (!canvas) throw new Error('Canvas with id="canvas" not found'); // defensive check
const renderer = new THREE.WebGLRenderer({canvas, antialias: true}); // create renderer
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR for perf
renderer.setSize(window.innerWidth, window.innerHeight); // initial size
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic tonemapper
renderer.toneMappingExposure = 1.0; // neutral exposure

/*
 Section: Orbit Controls
 ----------------------
 OrbitControls allows orbiting around the target (origin), with damping for smoother motion.
 Zoom is limited/disabled for a guided framing of the solar system.
*/
// Orbit controls for mouse/touch navigation
const controls = new OrbitControls(camera, renderer.domElement); // bind to renderer DOM
controls.enableDamping = true; // inertia-like smoothing
controls.dampingFactor = 0.08; // damping strength
controls.enableZoom = false; // disable wheel zoom (use distance bounds if enabled)
controls.minDistance = 10; // closest distance if zoom enabled
controls.maxDistance = 100; // farthest distance if zoom enabled
controls.update(); // apply initial damping state

/*
 Section: Clock
 -------------
 THREE.Clock gives us delta time between frames so animation speed is independent of FPS.
*/
// Clock for framerate‑independent animation
const clock = new THREE.Clock(); // used in renderLoop()


// Create near-camera pebbles (replaces old createSpaceDust usage)
if (!scene.userData.spaceDust) {
    scene.userData.spaceDust = createSpacePebbles(camera, {
        count: params.spaceDustCount,
        spread: params.spaceDustSpread,
        near: 2,
        far: 60,
        minScale: params.spaceDustMinScale,
        maxScale: params.spaceDustMaxScale
    });
}
/*
 Section: Animation Loop
 -----------------------
 The core frame callback that updates rotations and positions, then renders the scene.
 It uses dt (delta time) to keep motion consistent across different frame rates.
*/
/**
 * Main render loop: updates planet spins and orbits, moon orbits, ring and asteroid belt rotation.
 * Uses delta time from THREE.Clock for smooth, frame‑rate independent motion.
 */
const renderLoop = () => {
    const dt = clock.getDelta(); // seconds since last frame

    const t = params.timeScale ?? 1.0; // time multiplier (default: 1.0)


    // Animate each created planet: spin around its tilted axis, and orbit around sun
    created.forEach((obj) => {
        const p = obj.data; // planet config

        // spin planet about its (tilted) axis
        // note: adjust multiplier if rotation is too slow/fast
        obj.mesh.rotateY(p.speed * dt * t); // self-rotation (day)

        // orbit: rotate the orbitGroup around Y to move planet around sun
        obj.orbit.rotation.y += p.speed * dt * 0.2 * t; // revolution (year)

        // animate moons attached to this planet (if any)
        obj.mesh.children.forEach((child) => {
            if (child.userData && child.userData.isMoon && child.userData.orbit) {
                const mo = child.userData.orbit; // { distance, speed, angle }
                // advance orbital angle
                mo.angle += mo.speed * dt * t; // update angle by angular speed
                // set position relative to planet
                child.position.x = Math.sin(mo.angle) * mo.distance; // X in local space
                child.position.z = Math.cos(mo.angle) * mo.distance; // Z in local space
            }
        });
    });

    // Rotate Saturn's ring slowly (if present)
    const saturnObj = created.find(c => c.data.name === 'Saturn'); // find Saturn entry
    if (saturnObj && saturnObj.mesh.userData.ring) {
        saturnObj.mesh.userData.ring.rotation.y += 0.001 * t; // gentle spin for visual interest
    }

    // rotate asteroid belt if created
    if (scene.userData.asteroidBelt) {
        scene.userData.asteroidBelt.rotation.y += 0.02 * dt * t; // subtle motion
    }

    // --- Space Pebbles update ---
    const dustObj = scene.userData.spaceDust;
    if (dustObj) {
        // toggle visibility
        const enabled = !!params.spaceDustEnabled;
        dustObj.inst.visible = enabled;

        if (enabled) {
            const tScale = (params.timeScale ?? 1) * (params.spaceDustSpeed || 0.6);
            const dtMove = tScale * dt;

            const dummy = new THREE.Object3D();
            for (let i = 0; i < dustObj.pos.length; i++) {
                // Move towards camera: z increases toward 0 (we’re in camera-local space)
                dustObj.pos[i].z += dtMove;

                // Recycle when passing near plane
                if (dustObj.pos[i].z > -dustObj.near) {
                    dustObj.pos[i].z = -dustObj.far;
                    dustObj.pos[i].x = (Math.random() - 0.5) * dustObj.spread;
                    dustObj.pos[i].y = (Math.random() - 0.5) * dustObj.spread;
                }

                // Spin the rock
                dustObj.rotAngle[i] += dustObj.rotSpeed[i] * dt;

                // Write transform
                dummy.position.copy(dustObj.pos[i]);
                dummy.quaternion.setFromAxisAngle(dustObj.rotAxis[i], dustObj.rotAngle[i]);
                const s = dustObj.scale[i];
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                dustObj.inst.setMatrixAt(i, dummy.matrix);
            }
            dustObj.inst.instanceMatrix.needsUpdate = true;

            // Live changes: count/spread → recreate (simple)
            if (
                params.spaceDustCount !== dustObj.pos.length ||
                params.spaceDustSpread !== dustObj.spread ||
                params.spaceDustMinScale !== dustObj.sMin ||
                params.spaceDustMaxScale !== dustObj.sMax
            ) {
                dustObj.dispose();
                scene.userData.spaceDust = createSpacePebbles(camera, {
                    count: params.spaceDustCount,
                    spread: params.spaceDustSpread,
                    near: 2,
                    far: 60,
                    minScale: params.spaceDustMinScale,
                    maxScale: params.spaceDustMaxScale
                });
            }
        }
    }

    // --- labels update ---
    if (scene.userData._labels) {
        // toggle visibility
        const show = !!params.labelsEnabled;
        scene.userData._labels.forEach(({label}) => {
            label.visible = show;
        });

        if (show) {
            // billboard: make each label face the camera
            scene.userData._labels.forEach(({label}) => {
                // copy world-facing rotation
                label.quaternion.copy(camera.quaternion);
                // update size smoothly if changed
                const wantSize = params.labelSize || 0.6;
                if (label.fontSize && Math.abs(label.fontSize - wantSize) > 0.001) {
                    label.fontSize = wantSize;
                    if (label.sync) label.sync();
                }
            });
        }
    }


    controls.update(); // apply damping
    renderer.render(scene, camera); // draw frame
    window.requestAnimationFrame(renderLoop); // schedule next frame
};

renderLoop(); // kick off the loop

/*
 Section: Resize Handling
 -----------------------
 Keep the renderer and camera projection in sync with the browser window size.
*/
// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; // update aspect ratio
    camera.updateProjectionMatrix(); // recalc internal projection
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // respect DPR cap
    renderer.setSize(window.innerWidth, window.innerHeight); // resize canvas
});
