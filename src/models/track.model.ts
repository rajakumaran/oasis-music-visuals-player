export interface Track {
  file?: File;
  name: string;
  url: string;
  duration: string;
  /** True for user-uploaded files that must be pre-buffered before playback. */
  isUserUpload?: boolean;
}
