import { describe, expect, it } from "vitest";

import { CHEQUE_PHOTO_PICK_LIMIT, jpgName, needsShrink, pickRefusal, shrunkSize } from "./chequePhotoFile";

const MB = 1024 * 1024;

describe("which cheque photos are redrawn as a JPG before upload", () => {
    it("redraws a phone photo over 2 MB", () => {
        expect(needsShrink({ type: "image/jpeg", size: 6.4 * MB })).toBe(true);
        expect(needsShrink({ type: "image/png", size: 3 * MB })).toBe(true);
    });

    it("redraws an image of a type Frappe refuses for website users, however small", () => {
        expect(needsShrink({ type: "image/webp", size: 300 * 1024 })).toBe(true);
        expect(needsShrink({ type: "image/heic", size: 900 * 1024 })).toBe(true);
    });

    it("uploads a small JPG or PNG, and any PDF, as it is", () => {
        expect(needsShrink({ type: "image/jpeg", size: 1.5 * MB })).toBe(false);
        expect(needsShrink({ type: "image/png", size: 2 * MB })).toBe(false);
        expect(needsShrink({ type: "application/pdf", size: 9 * MB })).toBe(false);
    });
});

describe("the redrawn photo", () => {
    it("keeps the longest side at 2400 px and the shape of the cheque", () => {
        expect(shrunkSize(4000, 3000)).toEqual({ width: 2400, height: 1800 });
        expect(shrunkSize(3000, 4000)).toEqual({ width: 1800, height: 2400 });
    });

    it("is never enlarged", () => {
        expect(shrunkSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    });

    it("keeps the file's name, ending in .jpg", () => {
        expect(jpgName("IMG_1234.HEIC")).toBe("IMG_1234.jpg");
        expect(jpgName("cheque.photo.png")).toBe("cheque.photo.jpg");
        expect(jpgName("scan")).toBe("scan.jpg");
    });
});

describe("why the picker refused a file", () => {
    it("names the size limit or the types it takes", () => {
        expect(pickRefusal({ type: "size" })).toBe(`The file is over ${CHEQUE_PHOTO_PICK_LIMIT / MB} MB. Upload a smaller photo of the cheque.`);
        expect(pickRefusal({ type: "type" })).toBe("This file type cannot be read. Upload the cheque as a JPG, PNG or PDF.");
    });
});
