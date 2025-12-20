export interface EqualizerTheme {
  name: string;
  type: '3d' | 'led' | 'shadow' | 'glossy' | 'glass';
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
}
