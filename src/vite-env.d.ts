/// <reference types="vite/client" />

declare module "*.ttf?url" {
  const url: string;
  export default url;
}

declare module "*.ttf?inline" {
  const dataUrl: string;
  export default dataUrl;
}
