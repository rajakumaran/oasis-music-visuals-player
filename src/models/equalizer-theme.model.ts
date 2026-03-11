export interface EqualizerTheme {
  name: string;
  type: '3d' | 'led' | 'shadow' | 'glossy' | 'glass' | 'convex' | 'concave' | 'glass-box' | 'fractal' | 'neural' | 'plasma' | 'hyperlane' | 'aura' | 'glyphs' | 'liquid' | 'webgl' 
  | 'webgl-grok-lattice' | 'webgl-grok-rift' | 'webgl-grok-neural-ember' | 'webgl-grok-collapse' | 'webgl-grok-aurora'
  | 'webgl-shader-ferrofluid'  | 'webgl-shader-explosion' | 'webgl-shader-waves'| 'webgl-shader-fractal-zoom'| 'webgl-shader-nebula' | 'webgl-shader-plasma' | 'webgl-shader-plasma' | 'webgl-shader-geometry' | 'webgl-shader-particles' | 'webgl-shader-holo' | 'webgl-shader-fractal' | 'ford-circles'
  | 'helix' | 'polar-rose' | 'diamond' | 'orbits' | 'ripple' | 'nova'
  | 'base';
  base: string;
  display: string;
  bar: string;
  sliderTrack: string;
  sliderThumb: string;
  text: string;
  accent: string;
  button: string;
  buttonHover: string;
  highlight: string;
  fragmentShader?: string; // Optional for webgl themes
  webglMode?: 'bars' | 'terrain' | 'voxel-waves' | 'quantum-singularity';
}