/*
  Warnings:

  - The `estado` column on the `documentos_reparadores` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "estado_documento" AS ENUM ('pendiente', 'aprobado', 'rechazado', 'vencido');

-- DropIndex
DROP INDEX "mensajes_chat_ordenId_idx";

-- DropIndex
DROP INDEX "orden_trazabilidad_ordenId_idx";

-- DropIndex
DROP INDEX "transacciones_wallet_walletId_idx";

-- AlterTable
ALTER TABLE "documentos_reparadores" DROP COLUMN "estado",
ADD COLUMN     "estado" "estado_documento" NOT NULL DEFAULT 'pendiente';

-- AlterTable
ALTER TABLE "ordenes_servicio" ADD COLUMN     "tipoFallaId" UUID;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "codigoVerificacionExpiraEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tipos_falla" (
    "id" UUID NOT NULL,
    "categoriaId" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "causaProbable" TEXT,
    "solucionTipica" TEXT,
    "precioMinimo" DECIMAL(10,2) NOT NULL,
    "precioMaximo" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_falla_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tipos_falla_categoriaId_activo_idx" ON "tipos_falla"("categoriaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_falla_categoriaId_nombre_key" ON "tipos_falla"("categoriaId", "nombre");

-- CreateIndex
CREATE INDEX "garantias_fixicare_estado_fechaVencimiento_idx" ON "garantias_fixicare"("estado", "fechaVencimiento");

-- CreateIndex
CREATE INDEX "mensajes_chat_ordenId_creadoEn_idx" ON "mensajes_chat"("ordenId", "creadoEn");

-- CreateIndex
CREATE INDEX "orden_trazabilidad_ordenId_creadoEn_idx" ON "orden_trazabilidad"("ordenId", "creadoEn");

-- CreateIndex
CREATE INDEX "ordenes_servicio_estado_categoriaId_idx" ON "ordenes_servicio"("estado", "categoriaId");

-- CreateIndex
CREATE INDEX "ordenes_servicio_tipoFallaId_idx" ON "ordenes_servicio"("tipoFallaId");

-- CreateIndex
CREATE INDEX "ordenes_servicio_cuponId_idx" ON "ordenes_servicio"("cuponId");

-- CreateIndex
CREATE INDEX "ordenes_servicio_adminIntervencionId_idx" ON "ordenes_servicio"("adminIntervencionId");

-- CreateIndex
CREATE INDEX "transacciones_wallet_walletId_creadoEn_idx" ON "transacciones_wallet"("walletId", "creadoEn");

-- AddForeignKey
ALTER TABLE "tipos_falla" ADD CONSTRAINT "tipos_falla_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_tipoFallaId_fkey" FOREIGN KEY ("tipoFallaId") REFERENCES "tipos_falla"("id") ON DELETE SET NULL ON UPDATE CASCADE;
