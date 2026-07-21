"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ThreeObject3D = import("three").Object3D;
type ThreeMeshStandardMaterial = import("three").MeshStandardMaterial;

type Station = {
  code: string;
  en: string;
  jp: string;
  distance: number;
  motif: number[];
};

type HudState = {
  speed: number;
  distance: number;
  power: number;
  brake: number;
  score: number;
  stationIndex: number;
  limit: number;
  clock: string;
  phase: string;
  signal: "GREEN" | "YELLOW" | "RED";
  status: string;
  lateness: number;
  arrived: boolean;
};

type AudioRig = {
  context: AudioContext;
  master: GainNode;
  compressor: DynamicsCompressorNode;
  traction: OscillatorNode;
  tractionGain: GainNode;
  tractionHarmonic: OscillatorNode;
  tractionHarmonicGain: GainNode;
  inverter: OscillatorNode;
  inverterGain: GainNode;
  rumble: OscillatorNode;
  rumbleGain: GainNode;
  rollingNoise: AudioBufferSourceNode;
  rollingGain: GainNode;
  brakeNoise: AudioBufferSourceNode;
  brakeGain: GainNode;
  filter: BiquadFilterNode;
  chimeBus: GainNode;
};

const stations: Station[] = [
  { code: "JY20", en: "Shibuya", jp: "渋谷", distance: 740, motif: [67, 71, 74, 79] },
  { code: "JY21", en: "Ebisu", jp: "恵比寿", distance: 620, motif: [69, 72, 76, 74] },
  { code: "JY22", en: "Meguro", jp: "目黒", distance: 780, motif: [64, 68, 71, 76] },
  { code: "JY23", en: "Gotanda", jp: "五反田", distance: 690, motif: [62, 66, 69, 73] },
  { code: "JY24", en: "Osaki", jp: "大崎", distance: 810, motif: [65, 69, 72, 77] },
  { code: "JY25", en: "Shinagawa", jp: "品川", distance: 860, motif: [60, 64, 67, 72] },
  { code: "JY26", en: "Takanawa Gateway", jp: "高輪ゲートウェイ", distance: 650, motif: [72, 76, 79, 83] },
  { code: "JY27", en: "Tamachi", jp: "田町", distance: 760, motif: [67, 70, 74, 72] },
  { code: "JY28", en: "Hamamatsucho", jp: "浜松町", distance: 840, motif: [64, 67, 71, 76] },
  { code: "JY29", en: "Shimbashi", jp: "新橋", distance: 710, motif: [69, 73, 76, 81] },
  { code: "JY30", en: "Yurakucho", jp: "有楽町", distance: 610, motif: [66, 69, 73, 78] },
  { code: "JY01", en: "Tokyo", jp: "東京", distance: 680, motif: [72, 76, 79, 84] },
  { code: "JY02", en: "Kanda", jp: "神田", distance: 590, motif: [62, 65, 69, 74] },
  { code: "JY03", en: "Akihabara", jp: "秋葉原", distance: 650, motif: [71, 74, 78, 83] },
  { code: "JY04", en: "Okachimachi", jp: "御徒町", distance: 560, motif: [67, 71, 74, 76] },
  { code: "JY05", en: "Ueno", jp: "上野", distance: 630, motif: [64, 67, 72, 76] },
  { code: "JY06", en: "Uguisudani", jp: "鶯谷", distance: 710, motif: [69, 72, 76, 81] },
  { code: "JY07", en: "Nippori", jp: "日暮里", distance: 740, motif: [65, 69, 74, 77] },
  { code: "JY08", en: "Nishi-Nippori", jp: "西日暮里", distance: 610, motif: [62, 67, 71, 74] },
  { code: "JY09", en: "Tabata", jp: "田端", distance: 720, motif: [64, 68, 71, 76] },
  { code: "JY10", en: "Komagome", jp: "駒込", distance: 670, motif: [67, 70, 74, 79] },
  { code: "JY11", en: "Sugamo", jp: "巣鴨", distance: 620, motif: [65, 69, 72, 77] },
  { code: "JY12", en: "Otsuka", jp: "大塚", distance: 690, motif: [60, 64, 69, 72] },
  { code: "JY13", en: "Ikebukuro", jp: "池袋", distance: 870, motif: [69, 73, 76, 81] },
  { code: "JY14", en: "Mejiro", jp: "目白", distance: 680, motif: [64, 67, 71, 76] },
  { code: "JY15", en: "Takadanobaba", jp: "高田馬場", distance: 710, motif: [67, 71, 76, 79] },
  { code: "JY16", en: "Shin-Okubo", jp: "新大久保", distance: 650, motif: [62, 66, 71, 74] },
  { code: "JY17", en: "Shinjuku", jp: "新宿", distance: 820, motif: [71, 74, 78, 83] },
  { code: "JY18", en: "Yoyogi", jp: "代々木", distance: 570, motif: [65, 69, 72, 76] },
  { code: "JY19", en: "Harajuku", jp: "原宿", distance: 720, motif: [67, 72, 76, 79] },
];

const phaseName = (minutes: number) => {
  if (minutes < 300) return "深夜 · Deep night";
  if (minutes < 420) return "夜明け · Dawn";
  if (minutes < 720) return "朝 · Morning";
  if (minutes < 1020) return "昼 · Daylight";
  if (minutes < 1140) return "夕焼け · Golden hour";
  if (minutes < 1260) return "薄暮 · Blue hour";
  return "夜 · City lights";
};

const formatClock = (minutes: number) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const initialHud: HudState = {
  speed: 0,
  distance: stations[1].distance,
  power: 0,
  brake: 0,
  score: 1000,
  stationIndex: 0,
  limit: 65,
  clock: "05:18",
  phase: "夜明け · Dawn",
  signal: "GREEN",
  status: "Ready for departure",
  lateness: 0,
  arrived: false,
};

const midiToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export default function Home() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioRig | null>(null);
  const simRef = useRef({
    started: false,
    speed: 0,
    distance: stations[1].distance,
    power: 0,
    brake: 0,
    score: 1000,
    stationIndex: 0,
    elapsed: 0,
    dayMinutes: 318,
    arrived: false,
    dwell: 0,
    muted: false,
  });
  const [hud, setHud] = useState<HudState>(initialHud);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const current = stations[hud.stationIndex];
  const next = stations[(hud.stationIndex + 1) % stations.length];

  const initAudio = useCallback(() => {
    if (audioRef.current) {
      void audioRef.current.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0.56;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -17;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.28;
    master.connect(compressor).connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 920;
    filter.Q.value = 1.35;
    filter.connect(master);

    const traction = context.createOscillator();
    traction.type = "sawtooth";
    const tractionGain = context.createGain();
    tractionGain.gain.value = 0;
    traction.connect(tractionGain).connect(filter);
    traction.start();

    const tractionHarmonic = context.createOscillator();
    tractionHarmonic.type = "triangle";
    const tractionHarmonicGain = context.createGain();
    tractionHarmonicGain.gain.value = 0;
    tractionHarmonic.connect(tractionHarmonicGain).connect(filter);
    tractionHarmonic.start();

    const inverter = context.createOscillator();
    inverter.type = "sine";
    const inverterGain = context.createGain();
    inverterGain.gain.value = 0;
    const inverterFilter = context.createBiquadFilter();
    inverterFilter.type = "bandpass";
    inverterFilter.frequency.value = 1800;
    inverterFilter.Q.value = 1.8;
    inverter.connect(inverterGain).connect(inverterFilter).connect(master);
    inverter.start();

    const rumble = context.createOscillator();
    rumble.type = "sine";
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0;
    rumble.connect(rumbleGain).connect(master);
    rumble.start();

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < noiseData.length; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.018 * white) / 1.018;
      noiseData[index] = brown * 3.1;
    }

    const rollingNoise = context.createBufferSource();
    rollingNoise.buffer = noiseBuffer;
    rollingNoise.loop = true;
    const rollingGain = context.createGain();
    rollingGain.gain.value = 0;
    const rollingFilter = context.createBiquadFilter();
    rollingFilter.type = "bandpass";
    rollingFilter.frequency.value = 760;
    rollingFilter.Q.value = 0.72;
    rollingNoise.connect(rollingFilter).connect(rollingGain).connect(master);
    rollingNoise.start();

    const brakeNoise = context.createBufferSource();
    brakeNoise.buffer = noiseBuffer;
    brakeNoise.loop = true;
    const brakeGain = context.createGain();
    brakeGain.gain.value = 0;
    const brakeFilter = context.createBiquadFilter();
    brakeFilter.type = "highpass";
    brakeFilter.frequency.value = 1700;
    brakeNoise.connect(brakeFilter).connect(brakeGain).connect(master);
    brakeNoise.start();

    const chimeBus = context.createGain();
    chimeBus.gain.value = 0.86;
    const reverb = context.createConvolver();
    const reverbBuffer = context.createBuffer(2, context.sampleRate * 1.45, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const impulse = reverbBuffer.getChannelData(channel);
      for (let index = 0; index < impulse.length; index += 1) {
        impulse[index] = (Math.random() * 2 - 1) * (1 - index / impulse.length) ** 2.7;
      }
    }
    reverb.buffer = reverbBuffer;
    const reverbGain = context.createGain();
    reverbGain.gain.value = 0.19;
    chimeBus.connect(master);
    chimeBus.connect(reverb).connect(reverbGain).connect(master);

    audioRef.current = {
      context,
      master,
      compressor,
      traction,
      tractionGain,
      tractionHarmonic,
      tractionHarmonicGain,
      inverter,
      inverterGain,
      rumble,
      rumbleGain,
      rollingNoise,
      rollingGain,
      brakeNoise,
      brakeGain,
      filter,
      chimeBus,
    };
  }, []);

  const playChime = useCallback((motif: number[], soft = false) => {
    const rig = audioRef.current;
    if (!rig || simRef.current.muted) return;
    const now = rig.context.currentTime + 0.06;
    const sequence = [motif[0], motif[1], motif[2], motif[1], motif[3], motif[2], motif[3] + 2, motif[3]];
    const durations = [0.32, 0.29, 0.46, 0.27, 0.36, 0.33, 0.38, 0.78];
    let cursor = now;

    sequence.forEach((note, index) => {
      const start = cursor;
      const duration = durations[index];
      const fundamental = rig.context.createOscillator();
      const shimmer = rig.context.createOscillator();
      const gain = rig.context.createGain();
      const shimmerGain = rig.context.createGain();
      fundamental.type = "sine";
      shimmer.type = "triangle";
      fundamental.frequency.value = midiToHz(note);
      shimmer.frequency.value = midiToHz(note) * 2.005;
      shimmer.detune.value = index % 2 === 0 ? 3 : -4;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(soft ? 0.055 : 0.115, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.32);
      shimmerGain.gain.setValueAtTime(0.0001, start);
      shimmerGain.gain.exponentialRampToValueAtTime(soft ? 0.012 : 0.026, start + 0.012);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.18);
      fundamental.connect(gain).connect(rig.chimeBus);
      shimmer.connect(shimmerGain).connect(rig.chimeBus);
      fundamental.start(start);
      shimmer.start(start);
      fundamental.stop(start + duration + 0.38);
      shimmer.stop(start + duration + 0.24);

      if (index === 0 || index === 4 || index === 7) {
        const harmony = rig.context.createOscillator();
        const harmonyGain = rig.context.createGain();
        harmony.type = "sine";
        harmony.frequency.value = midiToHz(note - (index === 7 ? 5 : 12));
        harmonyGain.gain.setValueAtTime(0.0001, start);
        harmonyGain.gain.exponentialRampToValueAtTime(soft ? 0.018 : 0.038, start + 0.03);
        harmonyGain.gain.exponentialRampToValueAtTime(0.0001, start + duration + 0.42);
        harmony.connect(harmonyGain).connect(rig.chimeBus);
        harmony.start(start);
        harmony.stop(start + duration + 0.46);
      }
      cursor += duration;
    });
  }, []);

  const speakDeparture = useCallback((station: Station) => {
    if (simRef.current.muted || !("speechSynthesis" in window)) return false;
    const synthesis = window.speechSynthesis;
    const voices = synthesis.getVoices();
    const japanese = new SpeechSynthesisUtterance(`まもなく、${station.jp}です。`);
    japanese.lang = "ja-JP";
    japanese.rate = 0.88;
    japanese.pitch = 1.02;
    japanese.volume = 1;
    japanese.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) ?? null;
    const english = new SpeechSynthesisUtterance(`Next stop, ${station.en}.`);
    english.lang = "en-GB";
    english.rate = 0.88;
    english.pitch = 0.96;
    english.volume = 0.88;
    english.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ?? null;
    const spanish = new SpeechSynthesisUtterance(`Próxima parada, ${station.en}.`);
    spanish.lang = "es-ES";
    spanish.rate = 0.9;
    spanish.pitch = 0.98;
    spanish.volume = 0.9;
    spanish.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("es")) ?? null;
    japanese.onend = () => synthesis.speak(english);
    english.onend = () => synthesis.speak(spanish);
    synthesis.cancel();
    synthesis.resume();
    synthesis.speak(japanese);
    return true;
  }, []);

  const setPower = useCallback((notch: number) => {
    const sim = simRef.current;
    if (!sim.started || sim.arrived) return;
    sim.power = Math.min(4, Math.max(0, notch));
    if (sim.power > 0) sim.brake = 0;
  }, []);

  const setBrake = useCallback((notch: number) => {
    const sim = simRef.current;
    if (!sim.started) return;
    sim.brake = Math.min(8, Math.max(0, notch));
    if (sim.brake > 0) sim.power = 0;
  }, []);

  const coast = useCallback(() => {
    simRef.current.power = 0;
    simRef.current.brake = 0;
  }, []);

  const startRun = useCallback(() => {
    initAudio();
    const sim = simRef.current;
    sim.started = true;
    sim.power = 1;
    sim.brake = 0;
    setStarted(true);
    const voiceStarted = speakDeparture(next);
    window.setTimeout(() => playChime(current.motif, true), voiceStarted ? 5000 : 80);
  }, [current.motif, initAudio, next, playChime, speakDeparture]);

  const toggleMute = useCallback(() => {
    initAudio();
    const nextMuted = !simRef.current.muted;
    simRef.current.muted = nextMuted;
    setMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.master.gain.setTargetAtTime(nextMuted ? 0 : 0.56, audioRef.current.context.currentTime, 0.03);
    }
  }, [initAudio]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") setPower(simRef.current.power + 1);
      if (event.key === "ArrowDown") setBrake(simRef.current.brake + 1);
      if (event.key === " ") {
        event.preventDefault();
        coast();
      }
      if (event.key.toLowerCase() === "e") setBrake(8);
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [coast, setBrake, setPower]);

  useEffect(() => {
    const mount = viewportRef.current;
    if (!mount) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("three").then((THREE) => {
      if (disposed) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#8fb7c9");
    scene.fog = new THREE.Fog("#8fb7c9", 28, 205);
    const camera = new THREE.PerspectiveCamera(61, mount.clientWidth / mount.clientHeight, 0.1, 320);
    camera.position.set(0, 3.45, 8.2);
    camera.lookAt(0, 2.25, -45);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight("#d8efff", "#26302c", 1.35);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight("#ffe1ae", 2.4);
    sun.position.set(-22, 38, 18);
    sun.castShadow = true;
    const shadowSize = window.innerWidth < 760 ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 105;
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.045;
    sun.shadow.radius = 3;
    scene.add(sun);

    const world = new THREE.Group();
    scene.add(world);
    const moving: ThreeObject3D[] = [];
    const nightMaterials: ThreeMeshStandardMaterial[] = [];

    const trackBed = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.34, 280),
      new THREE.MeshStandardMaterial({ color: "#34383b", roughness: 1 }),
    );
    trackBed.position.set(0, 0.05, -108);
    trackBed.receiveShadow = true;
    scene.add(trackBed);

    [-1.55, 1.55].forEach((x) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.2, 280),
        new THREE.MeshStandardMaterial({ color: "#c4ccd0", metalness: 0.8, roughness: 0.28 }),
      );
      rail.position.set(x, 0.37, -108);
      rail.receiveShadow = true;
      scene.add(rail);
    });

    for (let i = 0; i < 82; i += 1) {
      const sleeper = new THREE.Mesh(
        new THREE.BoxGeometry(5.2, 0.16, 0.42),
        new THREE.MeshStandardMaterial({ color: i % 4 === 0 ? "#61594e" : "#4d4942", roughness: 1 }),
      );
      sleeper.position.set(0, 0.24, 18 - i * 3.2);
      sleeper.userData.wrap = 262;
      sleeper.receiveShadow = true;
      moving.push(sleeper);
      world.add(sleeper);
    }

    const buildingPalette = ["#b8b3aa", "#8d969c", "#d4c5b2", "#777d83", "#a39b91", "#d7d2c5", "#778989"];
    const signSpecs = [
      { text: "喫茶", bg: "#d95345", fg: "#fff6df" },
      { text: "薬", bg: "#f3f0dc", fg: "#d53c39" },
      { text: "食堂", bg: "#275e79", fg: "#f6ecd1" },
      { text: "酒場", bg: "#202a29", fg: "#efc36c" },
      { text: "珈琲", bg: "#714837", fg: "#fff1d8" },
      { text: "24H", bg: "#2f8368", fg: "#ffffff" },
    ];
    const signMaterials = signSpecs.map((spec) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = spec.bg;
        context.fillRect(0, 0, 256, 512);
        context.strokeStyle = "rgba(255,255,255,.72)";
        context.lineWidth = 12;
        context.strokeRect(15, 15, 226, 482);
        context.fillStyle = spec.fg;
        context.font = spec.text === "24H" ? "800 76px sans-serif" : "800 92px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        if (spec.text === "24H") context.fillText(spec.text, 128, 256);
        else [...spec.text].forEach((character, index) => context.fillText(character, 128, 160 + index * 180));
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
    });

    for (let i = 0; i < 56; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const width = 5 + ((i * 7) % 9);
      const height = 7 + ((i * 13) % 29);
      const depth = 7 + ((i * 5) % 12);
      const z = 12 - Math.floor(i / 2) * 10.2;
      const facade = new THREE.MeshStandardMaterial({
        color: buildingPalette[i % buildingPalette.length],
        roughness: 0.88,
        emissive: new THREE.Color(i % 3 === 0 ? "#f4bd72" : "#8fc7dc"),
        emissiveIntensity: 0.02,
      });
      nightMaterials.push(facade);
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), facade);
      building.position.set(side * (8.8 + width / 2 + ((i * 3) % 8)), height / 2, z);
      building.userData.wrap = 285;
      building.castShadow = false;
      building.receiveShadow = true;
      moving.push(building);
      world.add(building);

      const innerFace = -side * (width / 2 + 0.055);
      if (i % 2 === 0) {
        const windowMaterial = new THREE.MeshStandardMaterial({
          color: "#29383c",
          emissive: i % 4 === 0 ? "#ffd8a0" : "#a8d8e8",
          emissiveIntensity: 0.08,
          roughness: 0.48,
        });
        nightMaterials.push(windowMaterial);
        const rows = Math.min(4, Math.max(2, Math.floor(height / 6)));
        for (let row = 0; row < rows; row += 1) {
          const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.72, depth * 0.72), windowMaterial);
          windowBand.position.set(innerFace, -height / 2 + 3.1 + row * 3.25, 0);
          building.add(windowBand);
          if (i % 4 === 0 && row < 3) {
            const balcony = new THREE.Mesh(
              new THREE.BoxGeometry(0.42, 0.14, depth * 0.84),
              new THREE.MeshStandardMaterial({ color: "#535f60", metalness: 0.28, roughness: 0.66 }),
            );
            balcony.position.set(-side * (width / 2 + 0.22), windowBand.position.y - 0.62, 0);
            building.add(balcony);
          }
        }
      }

      if (i % 3 === 0) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 3.45), signMaterials[i % signMaterials.length]);
        sign.position.set(-side * (width / 2 + 0.18), Math.min(height * 0.24, height / 2 - 2.4), depth * 0.24);
        sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        building.add(sign);
      }

      if (i % 5 === 0) {
        const awningColor = ["#315e70", "#a44d42", "#d8cfad"][i % 3];
        const awning = new THREE.Mesh(
          new THREE.BoxGeometry(0.72, 0.22, depth * 0.76),
          new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.78 }),
        );
        awning.position.set(-side * (width / 2 + 0.3), -height / 2 + 2.6, 0);
        awning.rotation.z = side * 0.08;
        building.add(awning);

        const vendingGlow = new THREE.MeshStandardMaterial({
          color: "#e7ece6",
          emissive: "#cfe9df",
          emissiveIntensity: 0.34,
          roughness: 0.5,
        });
        nightMaterials.push(vendingGlow);
        const vendingMachine = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.9, 1.08), vendingGlow);
        vendingMachine.position.set(-side * (width / 2 + 0.34), -height / 2 + 1.22, depth * 0.3);
        building.add(vendingMachine);
      }

      if (i % 7 === 0) {
        const rooftop = new THREE.Mesh(
          new THREE.CylinderGeometry(1.15, 1.15, 1.35, 12),
          new THREE.MeshStandardMaterial({ color: "#d9ded9", metalness: 0.35, roughness: 0.56 }),
        );
        rooftop.position.set(width * 0.18, height / 2 + 0.68, 0);
        building.add(rooftop);
      }
    }

    for (let i = 0; i < 26; i += 1) {
      const pole = new THREE.Group();
      const postMat = new THREE.MeshStandardMaterial({ color: "#5c6468", metalness: 0.55, roughness: 0.56 });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.17, 7.6, 0.17), postMat);
      post.position.set(-5.8, 3.8, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.14, 0.14), postMat);
      arm.position.set(0, 7.25, 0);
      pole.add(post, arm);
      pole.position.z = 15 - i * 10.5;
      pole.userData.wrap = 273;
      moving.push(pole);
      world.add(pole);
    }

    const signalGroup = new THREE.Group();
    const signalPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 5.6, 0.22),
      new THREE.MeshStandardMaterial({ color: "#4b5356", metalness: 0.5 }),
    );
    signalPost.position.y = 2.8;
    const signalBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 1.7, 0.5),
      new THREE.MeshStandardMaterial({ color: "#202628", roughness: 0.62 }),
    );
    signalBox.position.y = 5.45;
    const signalLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 18, 18),
      new THREE.MeshStandardMaterial({ color: "#50e58a", emissive: "#50e58a", emissiveIntensity: 4 }),
    );
    signalLamp.position.set(0, 5.62, 0.28);
    signalGroup.add(signalPost, signalBox, signalLamp);
    signalGroup.position.set(5.1, 0, -72);
    scene.add(signalGroup);

    const stationGroup = new THREE.Group();
    const platformMat = new THREE.MeshStandardMaterial({ color: "#c7c4ba", roughness: 0.96 });
    [-1, 1].forEach((side) => {
      const platform = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.35, 95), platformMat);
      platform.position.set(side * 7.45, 0.56, -18);
      platform.receiveShadow = true;
      stationGroup.add(platform);
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.08, 95),
        new THREE.MeshStandardMaterial({ color: "#f0cf3f", emissive: "#c39b1e", emissiveIntensity: 0.12 }),
      );
      edge.position.set(side * 4.1, 1.27, -18);
      stationGroup.add(edge);
      for (let col = 0; col < 8; col += 1) {
        const column = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 5.2, 0.22),
          new THREE.MeshStandardMaterial({ color: "#dde2df", metalness: 0.28 }),
        );
        column.position.set(side * 7.2, 3.6, -50 + col * 12);
        column.castShadow = true;
        stationGroup.add(column);
      }

      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(6.5, 0.24, 76),
        new THREE.MeshStandardMaterial({ color: side > 0 ? "#65706e" : "#747d7a", metalness: 0.22, roughness: 0.66 }),
      );
      roof.position.set(side * 7.15, 6.12, -18);
      roof.castShadow = true;
      roof.receiveShadow = true;
      stationGroup.add(roof);

      const fluorescentMaterial = new THREE.MeshStandardMaterial({
        color: "#eef6ed",
        emissive: "#e8fff1",
        emissiveIntensity: 0.72,
        toneMapped: false,
      });
      nightMaterials.push(fluorescentMaterial);
      for (let lamp = 0; lamp < 6; lamp += 1) {
        const fluorescent = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 5.8), fluorescentMaterial);
        fluorescent.position.set(side * 5.95, 5.94, -47 + lamp * 11.6);
        stationGroup.add(fluorescent);
      }
    });
    stationGroup.position.z = -150;
    scene.add(stationGroup);

    const boardCanvas = document.createElement("canvas");
    boardCanvas.width = 1024;
    boardCanvas.height = 256;
    const boardContext = boardCanvas.getContext("2d");
    const boardTexture = new THREE.CanvasTexture(boardCanvas);
    boardTexture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 1.9),
      new THREE.MeshBasicMaterial({ map: boardTexture, side: THREE.DoubleSide }),
    );
    board.position.set(-4.02, 3.25, -3);
    board.rotation.y = Math.PI / 2;
    stationGroup.add(board);
    let drawnStation = -1;
    const drawStationBoard = (stationIndex: number) => {
      if (!boardContext || drawnStation === stationIndex) return;
      drawnStation = stationIndex;
      const target = stations[(stationIndex + 1) % stations.length];
      boardContext.fillStyle = "#f5f2e9";
      boardContext.fillRect(0, 0, 1024, 256);
      boardContext.fillStyle = "#111b1a";
      boardContext.font = "700 96px sans-serif";
      boardContext.fillText(target.jp, 54, 116);
      boardContext.font = "600 38px sans-serif";
      boardContext.fillText(target.en.toUpperCase(), 58, 176);
      boardContext.fillStyle = "#78b82a";
      boardContext.fillRect(0, 218, 1024, 38);
      boardContext.fillStyle = "#ffffff";
      boardContext.font = "700 30px sans-serif";
      boardContext.fillText(target.code, 850, 247);
      boardTexture.needsUpdate = true;
    };

    const cabMaterial = new THREE.MeshStandardMaterial({ color: "#141918", roughness: 0.64, metalness: 0.15 });
    const cab = new THREE.Group();
    const dash = new THREE.Mesh(new THREE.BoxGeometry(8.8, 1.1, 2.1), cabMaterial);
    dash.position.set(0, 1.6, 6.25);
    dash.rotation.x = -0.12;
    const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.38, 7.2, 0.35), cabMaterial);
    leftFrame.position.set(-4.28, 4.2, 5.6);
    leftFrame.rotation.z = -0.05;
    const rightFrame = leftFrame.clone();
    rightFrame.position.x = 4.28;
    rightFrame.rotation.z = 0.05;
    const topFrame = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.45, 0.45), cabMaterial);
    topFrame.position.set(0, 7.15, 5.55);
    cab.add(dash, leftFrame, rightFrame, topFrame);
    scene.add(cab);

    const clock = new THREE.Clock();
    let animationId = 0;
    let hudTimer = 0;
    let lastStation = 0;
    let lightingStep = -1;

    const resize = () => {
      if (!mount) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const renderFrame = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const sim = simRef.current;
      const speedMs = sim.speed / 3.6;

      if (sim.started) {
        sim.elapsed += dt;
        sim.dayMinutes = (sim.dayMinutes + dt * 8.2) % 1440;
        if (!sim.arrived) {
          const resistance = sim.speed > 0.1 ? 0.035 + sim.speed * 0.0005 : 0;
          const acceleration = sim.power * 0.19 - sim.brake * 0.31 - resistance;
          sim.speed = THREE.MathUtils.clamp(sim.speed + acceleration * dt * 3.6, 0, 92);
          sim.distance -= (sim.speed / 3.6) * dt;
          const dynamicLimit = sim.distance < 45 ? 15 : sim.distance < 115 ? 30 : sim.distance < 260 ? 45 : 65;
          if (sim.speed > dynamicLimit + 2) sim.score = Math.max(0, sim.score - (sim.speed - dynamicLimit) * dt * 0.42);

          if (sim.distance <= 9 && sim.speed <= 1.8) {
            const accuracy = Math.abs(sim.distance);
            sim.arrived = true;
            sim.dwell = 5.8;
            sim.power = 0;
            sim.brake = 5;
            sim.score = Math.max(0, sim.score + Math.round(260 - accuracy * 17));
            playChime(stations[(sim.stationIndex + 1) % stations.length].motif);
          } else if (sim.distance < -45 && sim.speed <= 1.8) {
            sim.arrived = true;
            sim.dwell = 4.4;
            sim.power = 0;
            sim.brake = 5;
            sim.score = Math.max(0, sim.score - 180);
          }
        } else {
          sim.speed = Math.max(0, sim.speed - dt * 4.8);
          sim.dwell -= dt;
          if (sim.dwell <= 0) {
            sim.stationIndex = (sim.stationIndex + 1) % stations.length;
            const after = stations[(sim.stationIndex + 1) % stations.length];
            sim.distance = after.distance;
            sim.arrived = false;
            sim.brake = 0;
            sim.power = 1;
            sim.elapsed = 0;
          }
        }
      }

      const travel = speedMs * dt * 0.94;
      moving.forEach((object) => {
        object.position.z += travel;
        if (object.position.z > 24) object.position.z -= Number(object.userData.wrap ?? 270);
      });

      const stationZ = -Math.max(-8, Math.min(155, sim.distance * 0.2));
      stationGroup.position.z = stationZ;
      drawStationBoard(sim.stationIndex);

      const signalState = sim.distance < 70 ? "RED" : sim.distance < 230 ? "YELLOW" : "GREEN";
      const signalColors = { GREEN: "#50e58a", YELLOW: "#ffd04a", RED: "#ff5a55" } as const;
      const lampMaterial = signalLamp.material as ThreeMeshStandardMaterial;
      lampMaterial.color.set(signalColors[signalState]);
      lampMaterial.emissive.set(signalColors[signalState]);
      signalGroup.position.z = sim.distance < 235 ? -Math.max(16, sim.distance * 0.28) : -72;

      const day = sim.dayMinutes / 1440;
      const sunHeight = Math.sin((day - 0.25) * Math.PI * 2);
      const daylight = THREE.MathUtils.clamp((sunHeight + 0.18) * 1.25, 0.035, 1);
      const dawnGlow = Math.max(0, 1 - Math.abs(day - 0.25) / 0.11);
      const duskGlow = Math.max(0, 1 - Math.abs(day - 0.76) / 0.12);
      const warm = Math.max(dawnGlow, duskGlow);
      const night = 1 - daylight;
      const skyDay = new THREE.Color("#75b9dc");
      const skyNight = new THREE.Color("#071320");
      const sky = skyNight.clone().lerp(skyDay, daylight);
      sky.lerp(new THREE.Color("#e89068"), warm * 0.42);
      scene.background = sky;
      if (scene.fog) scene.fog.color.copy(sky);
      ambient.intensity = 0.18 + daylight * 1.28;
      ambient.color.set(daylight > 0.4 ? "#dbefff" : "#6784a0");
      sun.intensity = daylight * 2.8;
      sun.color.set(warm > 0.22 ? "#ffbf82" : "#fff1d0");
      const nextLightingStep = Math.floor(sim.dayMinutes / 12);
      if (nextLightingStep !== lightingStep) {
        lightingStep = nextLightingStep;
        const stableDay = (lightingStep * 12) / 1440;
        sun.position.x = Math.cos(stableDay * Math.PI * 2) * 42;
        sun.position.y = 8 + daylight * 38;
        sun.position.z = Math.sin(stableDay * Math.PI * 2) * 24;
        sun.shadow.needsUpdate = true;
      }
      nightMaterials.forEach((material) => {
        material.emissiveIntensity = 0.03 + night * 1.8;
      });

      camera.position.y = 3.45 + Math.sin(sim.elapsed * (2.1 + sim.speed * 0.12)) * Math.min(0.025, sim.speed * 0.0005);
      camera.rotation.z = Math.sin(sim.elapsed * 0.45) * Math.min(0.0028, sim.speed * 0.00008);

      const rig = audioRef.current;
      if (rig) {
        const now = rig.context.currentTime;
        const audible = sim.started && !sim.muted ? 1 : 0;
        const speedRatio = Math.min(1, sim.speed / 78);
        const loadRatio = sim.power / 4;
        const brakingRatio = sim.brake / 8;
        const motorFrequency = 44 + sim.speed * 3.65 + sim.power * 15;
        const motorGain = audible * (0.012 + speedRatio * 0.032 + loadRatio * 0.026);
        rig.traction.frequency.setTargetAtTime(motorFrequency, now, 0.065);
        rig.tractionHarmonic.frequency.setTargetAtTime(motorFrequency * 2.015, now, 0.055);
        rig.inverter.frequency.setTargetAtTime(540 + sim.speed * 30 + sim.power * 96, now, 0.045);
        rig.rumble.frequency.setTargetAtTime(28 + sim.speed * 0.32, now, 0.11);
        rig.tractionGain.gain.setTargetAtTime(motorGain, now, 0.08);
        rig.tractionHarmonicGain.gain.setTargetAtTime(motorGain * 0.37, now, 0.07);
        rig.inverterGain.gain.setTargetAtTime(audible * loadRatio * (0.006 + speedRatio * 0.012), now, 0.06);
        rig.rumbleGain.gain.setTargetAtTime(audible * speedRatio * 0.038, now, 0.14);
        rig.rollingNoise.playbackRate.setTargetAtTime(0.58 + speedRatio * 1.55, now, 0.12);
        rig.rollingGain.gain.setTargetAtTime(audible * speedRatio * speedRatio * 0.11, now, 0.12);
        rig.brakeNoise.playbackRate.setTargetAtTime(0.82 + speedRatio * 0.7, now, 0.1);
        rig.brakeGain.gain.setTargetAtTime(audible * brakingRatio * Math.min(1, sim.speed / 18) * 0.075, now, 0.045);
        rig.filter.frequency.setTargetAtTime(520 + sim.speed * 21 + sim.power * 80, now, 0.1);
      }

      hudTimer += dt;
      if (hudTimer > 0.09) {
        hudTimer = 0;
        const limit = sim.distance < 45 ? 15 : sim.distance < 115 ? 30 : sim.distance < 260 ? 45 : 65;
        const lateness = Math.round(sim.elapsed - 52);
        const status = sim.arrived
          ? Math.abs(sim.distance) <= 3
            ? "PERFECT STOP · 定位置"
            : sim.distance < -9
              ? "OVERRUN · 停止位置修正"
              : "DOORS OPEN · 乗降中"
          : sim.distance < 120
            ? "BRAKE CURVE · 制動"
            : sim.speed > limit + 2
              ? "OVERSPEED · 減速"
              : sim.power > 0
                ? "POWER · 力行"
                : sim.brake > 0
                  ? "BRAKE · 制動"
                  : "COAST · 惰行";
        setHud({
          speed: sim.speed,
          distance: sim.distance,
          power: sim.power,
          brake: sim.brake,
          score: Math.round(sim.score),
          stationIndex: sim.stationIndex,
          limit,
          clock: formatClock(sim.dayMinutes),
          phase: phaseName(sim.dayMinutes),
          signal: signalState,
          status,
          lateness,
          arrived: sim.arrived,
        });
      }

      if (lastStation !== sim.stationIndex) {
        lastStation = sim.stationIndex;
        speakDeparture(stations[(sim.stationIndex + 1) % stations.length]);
      }
      renderer.render(scene, camera);
      animationId = requestAnimationFrame(renderFrame);
    };
    renderFrame();

    cleanup = () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material?.dispose();
        }
      });
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [playChime, speakDeparture]);

  return (
    <main className="game-shell">
      <div ref={viewportRef} className="world" aria-label="Vista 3D desde la cabina del tren" />
      <div className="sky-grain" aria-hidden="true" />

      <header className="top-bar">
        <div className="brand-lockup">
          <span className="loop-mark" aria-hidden="true" />
          <div>
            <strong>YAMANOTE // LOOP</strong>
            <span>Tokyo cab study · 山手線</span>
          </div>
        </div>
        <div className="top-actions">
          <button className="icon-button" type="button" onClick={toggleMute} aria-label={muted ? "Activar sonido" : "Silenciar sonido"}>
            {muted ? "SOUND OFF" : "SOUND ON"}
          </button>
          <button className="icon-button" type="button" onClick={() => setHelpOpen(true)} aria-label="Abrir guía">
            GUIDE
          </button>
        </div>
      </header>

      <section className="route-card" aria-label="Próxima estación">
        <div className="route-line">
          <span className="station-dot current-dot" />
          <span className="route-progress" style={{ "--progress": `${Math.max(2, Math.min(100, 100 - (hud.distance / next.distance) * 100))}%` } as React.CSSProperties} />
          <span className="station-dot next-dot" />
        </div>
        <div className="route-names">
          <div>
            <small>FROM · 発</small>
            <span>{current.en}</span>
          </div>
          <div className="next-name">
            <small>NEXT · 次</small>
            <strong>{next.jp}</strong>
            <span>{next.en}</span>
          </div>
          <span className="station-code">{next.code}</span>
        </div>
      </section>

      <aside className="time-card" aria-label="Hora y fase del día">
        <span className="live-dot" />
        <div>
          <strong>{hud.clock}</strong>
          <span>{hud.phase}</span>
        </div>
      </aside>

      <section className="speed-cluster" aria-label="Velocidad">
        <div className="speed-ring" style={{ "--speed": `${Math.min(100, hud.speed) * 3.6}deg` } as React.CSSProperties}>
          <span className="speed-number">{Math.round(hud.speed)}</span>
          <small>km/h</small>
        </div>
        <div className="speed-meta">
          <span className={`signal-pill signal-${hud.signal.toLowerCase()}`}><i />{hud.signal}</span>
          <span>LIMIT {hud.limit}</span>
          <span>{Math.max(0, Math.round(hud.distance))} m TO STOP</span>
        </div>
      </section>

      <section className="status-strip" aria-live="polite">
        <span>{hud.status}</span>
        <div>
          <small>RUN SCORE</small>
          <strong>{hud.score.toString().padStart(4, "0")}</strong>
        </div>
        <div>
          <small>SCHEDULE</small>
          <strong className={hud.lateness > 4 ? "late" : ""}>{hud.lateness > 0 ? `+${hud.lateness}s` : `${hud.lateness}s`}</strong>
        </div>
      </section>

      <section className="cab-controls" aria-label="Controles de conducción">
        <div className="notch-readout">
          <small>MASTER CONTROLLER</small>
          <strong className={hud.brake >= 8 ? "emergency" : ""}>
            {hud.brake >= 8 ? "EB" : hud.brake > 0 ? `B${hud.brake}` : hud.power > 0 ? `P${hud.power}` : "N"}
          </strong>
          <span>{hud.brake > 0 ? "BRAKE" : hud.power > 0 ? "POWER" : "NEUTRAL"}</span>
        </div>
        <div className="control-pad">
          <button
            type="button"
            className="drive-button power-button"
            onPointerDown={() => setPower(hud.power + 1)}
            aria-label="Aumentar potencia"
          >
            <span>POWER</span>
            <strong>＋</strong>
          </button>
          <button type="button" className="drive-button coast-button" onPointerDown={coast} aria-label="Punto muerto">
            <span>COAST</span>
            <strong>N</strong>
          </button>
          <button
            type="button"
            className="drive-button brake-button"
            onPointerDown={() => setBrake(hud.brake + 1)}
            aria-label="Aumentar freno"
          >
            <span>BRAKE</span>
            <strong>−</strong>
          </button>
        </div>
        <button type="button" className="emergency-button" onClick={() => setBrake(8)} aria-label="Freno de emergencia">
          EB
        </button>
      </section>

      {!started && (
        <section className="start-screen">
          <div className="start-card">
            <div className="start-kicker"><span /> TOKYO · 05:18 · INNER LOOP</div>
            <h1>Take the first train<br /><em>through a waking city.</em></h1>
            <p>
              Una cabina 3D mobile-first. Domina la inercia, respeta las señales y detén el tren en la marca exacta mientras Tokio recorre un día completo.
            </p>
            <button type="button" className="start-button" onClick={startRun}>
              <span>ENTER THE CAB</span>
              <small>運転開始 · activar sonido</small>
            </button>
            <div className="crew-consensus">
              <div>{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>
              <p><strong>7 / 7 crew consensus</strong><br />Playful · immersive · respectful</p>
            </div>
          </div>
          <p className="unofficial-note">Independent interactive tribute · no afiliado a JR East</p>
        </section>
      )}

      {helpOpen && (
        <section className="guide-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <div className="guide-card">
            <button className="guide-close" type="button" onClick={() => setHelpOpen(false)} aria-label="Cerrar guía">×</button>
            <span className="eyebrow">DRIVER&apos;S POCKET MANUAL</span>
            <h2 id="guide-title">Conduce con oído y tacto.</h2>
            <div className="guide-grid">
              <div><b>01</b><strong>Potencia</strong><p>Sube hasta P4. Deja que el tren gane velocidad y pasa a N antes del límite.</p></div>
              <div><b>02</b><strong>Freno</strong><p>Aplica B1–B5 progresivamente. La zona de parada empieza a 120 m.</p></div>
              <div><b>03</b><strong>Precisión</strong><p>Detente a ±3 m para la parada perfecta. El exceso de velocidad resta puntos.</p></div>
              <div><b>04</b><strong>Teclado</strong><p>↑ potencia · ↓ freno · espacio N · E emergencia.</p></div>
            </div>
            <div className="sound-note">
              <span>♪</span>
              <p>Las melodías de este prototipo son composiciones originales sintetizadas en el navegador, inspiradas en la cultura ferroviaria japonesa. No se redistribuyen MIDIs comerciales ni melodías oficiales.</p>
            </div>
          </div>
        </section>
      )}

      <div className="orientation-hint">Gira el móvil para una cabina panorámica · 横向き推奨</div>
    </main>
  );
}
