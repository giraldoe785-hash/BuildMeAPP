-- AlterTable
ALTER TABLE "documentos_reparadores" ADD COLUMN     "mimeType" VARCHAR(100),
ADD COLUMN     "nombreOriginal" VARCHAR(255),
ADD COLUMN     "tamanoBytes" INTEGER;
