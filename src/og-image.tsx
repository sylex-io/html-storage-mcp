import { ImageResponse } from "@takumi-rs/image-response/wasm";
import wasmModule from "@takumi-rs/wasm/takumi_wasm_bg.wasm";
import arialBoldFontDataUrl from "./assets/Arial-Bold.ttf?inline";
import arialFontDataUrl from "./assets/Arial.ttf?inline";

const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const OG_IMAGE_FORMAT = "png";
const ACCENT_COLOR = "#116bb5";

type OgImageResponseInput = {
  label: string | null;
  title: string;
};

const bodyFontData = decodeDataUrlToUint8Array(arialFontDataUrl);
const headingFontData = decodeDataUrlToUint8Array(arialBoldFontDataUrl);

export async function createOgImageResponse(
  { label, title }: OgImageResponseInput
): Promise<Response> {
  return new ImageResponse(<OgImageCard label={label} title={title} />, {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    format: OG_IMAGE_FORMAT,
    module: wasmModule,
    fonts: [
      {
        name: "Arial",
        data: bodyFontData,
        weight: 400,
        style: "normal"
      },
      {
        name: "Arial",
        data: headingFontData,
        weight: 700,
        style: "normal"
      }
    ],
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}

function decodeDataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid inline font asset.");
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function OgImageCard({ label, title }: OgImageResponseInput) {
  return (
    <div tw="relative flex h-full w-full flex-col overflow-hidden bg-white">
      <div
        tw="absolute left-[-90px] top-[-120px] h-[360px] w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, rgba(17,107,181,0.18) 0%, rgba(17,107,181,0.07) 42%, rgba(17,107,181,0) 76%)"
        }}
      />
      <div
        tw="absolute bottom-[-220px] right-[-160px] h-[520px] w-[620px] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, rgba(17,107,181,0.1) 0%, rgba(17,107,181,0.04) 44%, rgba(17,107,181,0) 76%)"
        }}
      />
      <div tw="absolute inset-0 border border-[#eceef1]" />

      <div
        tw="relative flex h-full flex-col justify-center"
        style={{
          padding: "72px 80px",
          zIndex: 1
        }}
      >
        <div
          tw="flex flex-col"
          style={{
            gap: "32px"
          }}
        >
          {label ? (
            <div tw="flex">
            <div
                tw="rounded-full border font-semibold uppercase"
                style={{
                  fontFamily: "Arial",
                  borderColor: "rgba(17,107,181,0.22)",
                  color: ACCENT_COLOR,
                  backgroundColor: "rgba(17,107,181,0.06)",
                  fontSize: "22px",
                  letterSpacing: "0.28em",
                  lineHeight: 1,
                  padding: "14px 22px"
                }}
              >
                {label}
              </div>
            </div>
          ) : null}

          <h1
            tw="max-w-[920px] font-bold"
            style={{
              fontFamily: "Arial",
              color: "#111111",
              fontSize: "78px",
              lineHeight: 1.02,
              letterSpacing: "-0.04em",
              wordBreak: "break-word"
            }}
          >
            {title}
          </h1>
        </div>

      </div>
    </div>
  );
}
