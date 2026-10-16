-- CreateEnum
CREATE TYPE "proveedor_oauth" AS ENUM ('GOOGLE', 'MICROSOFT_ENTRA_ID');

-- CreateEnum
CREATE TYPE "tipo_desafio_mfa" AS ENUM ('LOGIN_LOCAL', 'LOGIN_OAUTH', 'REGISTRO', 'VINCULAR_CORREO');

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "identidades_oauth" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "proveedor" "proveedor_oauth" NOT NULL,
    "proveedorAccountId" VARCHAR(255) NOT NULL,
    "correoProveedor" VARCHAR(150),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identidades_oauth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desafios_mfa" (
    "id" UUID NOT NULL,
    "usuarioId" UUID,
    "tokenHash" VARCHAR(64) NOT NULL,
    "codigoHash" VARCHAR(64),
    "correoDestino" VARCHAR(150),
    "tipo" "tipo_desafio_mfa" NOT NULL,
    "proveedor" "proveedor_oauth",
    "proveedorAccountId" VARCHAR(255),
    "nombreProveedor" VARCHAR(200),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "reenvios" INTEGER NOT NULL DEFAULT 0,
    "fechaUltimoEnvio" TIMESTAMP(3),
    "fechaExpira" TIMESTAMP(3) NOT NULL,
    "consumidoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desafios_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identidades_oauth_usuarioId_idx" ON "identidades_oauth"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "identidades_oauth_proveedor_proveedorAccountId_key" ON "identidades_oauth"("proveedor", "proveedorAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "desafios_mfa_tokenHash_key" ON "desafios_mfa"("tokenHash");

-- CreateIndex
CREATE INDEX "desafios_mfa_usuarioId_consumidoEn_idx" ON "desafios_mfa"("usuarioId", "consumidoEn");

-- CreateIndex
CREATE INDEX "desafios_mfa_fechaExpira_idx" ON "desafios_mfa"("fechaExpira");

-- AddForeignKey
ALTER TABLE "identidades_oauth" ADD CONSTRAINT "identidades_oauth_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desafios_mfa" ADD CONSTRAINT "desafios_mfa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
