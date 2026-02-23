import {
  MANUAL_UPLOAD_ACCEPT,
  getFileExtensionFromMime,
  resolveUploadMimeType,
  uploadAudioForTranscription,
} from "./audio-upload";

describe("audio-upload helpers", () => {
  it("maps upload MIME types to file extensions", () => {
    expect(getFileExtensionFromMime("audio/mpeg")).toBe("mp3");
    expect(getFileExtensionFromMime("audio/mp3")).toBe("mp3");
    expect(getFileExtensionFromMime("audio/x-m4a")).toBe("m4a");
    expect(getFileExtensionFromMime("audio/mp4")).toBe("mp4");
    expect(getFileExtensionFromMime("audio/ogg")).toBe("ogg");
    expect(getFileExtensionFromMime("audio/wav")).toBe("wav");
    expect(getFileExtensionFromMime("")).toBe("webm");
  });

  it("resolves supported manual upload MIME types by browser MIME or extension", () => {
    expect(
      resolveUploadMimeType(new File(["fake"], "manual.mp3", { type: "audio/mpeg" }))
    ).toBe("audio/mpeg");
    expect(
      resolveUploadMimeType(new File(["fake"], "manual.mp3", { type: "" }))
    ).toBe("audio/mpeg");
    expect(
      resolveUploadMimeType(new File(["fake"], "manual.m4a", { type: "audio/x-m4a" }))
    ).toBe("audio/mp4");
    expect(
      resolveUploadMimeType(new File(["fake"], "manual.m4a", { type: "" }))
    ).toBe("audio/mp4");
  });

  it("rejects unsupported manual upload formats", () => {
    expect(
      resolveUploadMimeType(new File(["fake"], "manual.wav", { type: "audio/wav" }))
    ).toBeNull();
  });

  it("includes both extension and MIME values in the accepted input list", () => {
    expect(MANUAL_UPLOAD_ACCEPT).toContain(".mp3");
    expect(MANUAL_UPLOAD_ACCEPT).toContain(".m4a");
    expect(MANUAL_UPLOAD_ACCEPT).toContain("audio/mpeg");
    expect(MANUAL_UPLOAD_ACCEPT).toContain("audio/mp4");
  });

  it("reports upload progress percentages when XMLHttpRequest is available", async () => {
    const originalXmlHttpRequest = global.XMLHttpRequest;

    class MockXmlHttpRequest {
      status = 200;
      responseType: XMLHttpRequestResponseType = "";
      response: unknown = {
        id: "memo-1",
        success: true,
      };
      responseText = JSON.stringify(this.response);
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      upload = {
        onprogress: null as ((event: ProgressEvent<XMLHttpRequestEventTarget>) => void) | null,
      };

      open() {
        // no-op for test
      }

      send() {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 25,
          total: 100,
        } as ProgressEvent<XMLHttpRequestEventTarget>);
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 100,
          total: 100,
        } as ProgressEvent<XMLHttpRequestEventTarget>);
        this.onload?.();
      }
    }

    try {
      Object.defineProperty(global, "XMLHttpRequest", {
        configurable: true,
        writable: true,
        value: MockXmlHttpRequest,
      });

      const progressValues: number[] = [];
      const result = await uploadAudioForTranscription(new FormData(), (percent) => {
        progressValues.push(percent);
      });

      expect(progressValues).toEqual([25, 100, 100]);
      expect(result).toEqual({
        id: "memo-1",
        success: true,
      });
    } finally {
      Object.defineProperty(global, "XMLHttpRequest", {
        configurable: true,
        writable: true,
        value: originalXmlHttpRequest,
      });
    }
  });
});
