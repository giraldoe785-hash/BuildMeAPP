-- CreateEnum
CREATE TYPE "estado_ticket" AS ENUM ('abierto', 'en_gestion', 'en_espera_usuario', 'resuelto', 'cerrado');

-- CreateEnum
CREATE TYPE "prioridad_ticket" AS ENUM ('baja', 'media', 'alta', 'critica');

-- CreateEnum
CREATE TYPE "categoria_ticket" AS ENUM ('incomparecencia', 'disputa_costo', 'comportamiento_indebido', 'falla_tecnica_app', 'garantia_inconforme', 'otro');

-- CreateEnum
CREATE TYPE "estado_reclamacion_garantia" AS ENUM ('en_revision', 'visita_aprobada', 'reembolso_aprobado', 'rechazada');

-- CreateEnum
CREATE TYPE "destino_reembolso" AS ENUM ('tarjeta_origen', 'fixi_wallet');

-- CreateEnum
CREATE TYPE "estado_reembolso" AS ENUM ('solicitado', 'procesado', 'fallido');

-- CreateTable
CREATE TABLE "orden_trazabilidad" (
    "id" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "estadoAnterior" "estado_orden",
    "estadoNuevo" "estado_orden" NOT NULL,
    "cambiadoPorUsuarioId" UUID NOT NULL,
    "rolOperador" "rol_usuario" NOT NULL,
    "motivoCambio" VARCHAR(255),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_trazabilidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets_soporte" (
    "id" UUID NOT NULL,
    "numeroTicket" VARCHAR(30) NOT NULL,
    "usuarioEmisorId" UUID NOT NULL,
    "agenteAsignadoId" UUID,
    "ordenId" UUID,
    "categoria" "categoria_ticket" NOT NULL,
    "prioridad" "prioridad_ticket" NOT NULL DEFAULT 'media',
    "estado" "estado_ticket" NOT NULL DEFAULT 'abierto',
    "asunto" VARCHAR(150) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "resolucionDictamen" TEXT,
    "fechaLimiteSla" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "cerradoEn" TIMESTAMP(3),

    CONSTRAINT "tickets_soporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_soporte" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "emisorId" UUID NOT NULL,
    "mensaje" TEXT NOT NULL,
    "archivoAdjuntoUrl" TEXT,
    "esNotaInterna" BOOLEAN NOT NULL DEFAULT false,
    "leido" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_soporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reclamaciones_garantia" (
    "id" UUID NOT NULL,
    "garantiaId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "descripcionFalla" TEXT NOT NULL,
    "evidenciaMultimediaUrl" TEXT NOT NULL,
    "estado" "estado_reclamacion_garantia" NOT NULL DEFAULT 'en_revision',
    "ordenGarantiaId" UUID,
    "dictamenPericial" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMP(3),

    CONSTRAINT "reclamaciones_garantia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reembolsos_transacciones" (
    "id" UUID NOT NULL,
    "numeroComprobante" VARCHAR(50) NOT NULL,
    "ordenId" UUID NOT NULL,
    "ticketId" UUID,
    "autorizadoPorUsuarioId" UUID NOT NULL,
    "segundoAutorizadorId" UUID,
    "destino" "destino_reembolso" NOT NULL,
    "estado" "estado_reembolso" NOT NULL DEFAULT 'solicitado',
    "monto" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "pasarelaRefundId" VARCHAR(100),
    "errorDetalle" VARCHAR(255),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaAutorizacion" TIMESTAMP(3),
    "fechaSegundaAutorizacion" TIMESTAMP(3),
    "procesadoEn" TIMESTAMP(3),

    CONSTRAINT "reembolsos_transacciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_trazabilidad_ordenId_idx" ON "orden_trazabilidad"("ordenId");

-- CreateIndex
CREATE INDEX "orden_trazabilidad_cambiadoPorUsuarioId_idx" ON "orden_trazabilidad"("cambiadoPorUsuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_soporte_numeroTicket_key" ON "tickets_soporte"("numeroTicket");

-- CreateIndex
CREATE INDEX "tickets_soporte_usuarioEmisorId_idx" ON "tickets_soporte"("usuarioEmisorId");

-- CreateIndex
CREATE INDEX "tickets_soporte_agenteAsignadoId_idx" ON "tickets_soporte"("agenteAsignadoId");

-- CreateIndex
CREATE INDEX "tickets_soporte_ordenId_idx" ON "tickets_soporte"("ordenId");

-- CreateIndex
CREATE INDEX "tickets_soporte_estado_idx" ON "tickets_soporte"("estado");

-- CreateIndex
CREATE INDEX "tickets_soporte_prioridad_idx" ON "tickets_soporte"("prioridad");

-- CreateIndex
CREATE INDEX "mensajes_soporte_ticketId_idx" ON "mensajes_soporte"("ticketId");

-- CreateIndex
CREATE INDEX "mensajes_soporte_emisorId_idx" ON "mensajes_soporte"("emisorId");

-- CreateIndex
CREATE UNIQUE INDEX "reclamaciones_garantia_ticketId_key" ON "reclamaciones_garantia"("ticketId");

-- CreateIndex
CREATE INDEX "reclamaciones_garantia_garantiaId_idx" ON "reclamaciones_garantia"("garantiaId");

-- CreateIndex
CREATE INDEX "reclamaciones_garantia_ordenGarantiaId_idx" ON "reclamaciones_garantia"("ordenGarantiaId");

-- CreateIndex
CREATE UNIQUE INDEX "reembolsos_transacciones_numeroComprobante_key" ON "reembolsos_transacciones"("numeroComprobante");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_ordenId_idx" ON "reembolsos_transacciones"("ordenId");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_ticketId_idx" ON "reembolsos_transacciones"("ticketId");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_estado_idx" ON "reembolsos_transacciones"("estado");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_autorizadoPorUsuarioId_idx" ON "reembolsos_transacciones"("autorizadoPorUsuarioId");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_segundoAutorizadorId_idx" ON "reembolsos_transacciones"("segundoAutorizadorId");

-- AddForeignKey
ALTER TABLE "orden_trazabilidad" ADD CONSTRAINT "orden_trazabilidad_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_trazabilidad" ADD CONSTRAINT "orden_trazabilidad_cambiadoPorUsuarioId_fkey" FOREIGN KEY ("cambiadoPorUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets_soporte" ADD CONSTRAINT "tickets_soporte_usuarioEmisorId_fkey" FOREIGN KEY ("usuarioEmisorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets_soporte" ADD CONSTRAINT "tickets_soporte_agenteAsignadoId_fkey" FOREIGN KEY ("agenteAsignadoId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets_soporte" ADD CONSTRAINT "tickets_soporte_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_soporte" ADD CONSTRAINT "mensajes_soporte_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets_soporte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_soporte" ADD CONSTRAINT "mensajes_soporte_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamaciones_garantia" ADD CONSTRAINT "reclamaciones_garantia_garantiaId_fkey" FOREIGN KEY ("garantiaId") REFERENCES "garantias_fixicare"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamaciones_garantia" ADD CONSTRAINT "reclamaciones_garantia_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets_soporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reclamaciones_garantia" ADD CONSTRAINT "reclamaciones_garantia_ordenGarantiaId_fkey" FOREIGN KEY ("ordenGarantiaId") REFERENCES "ordenes_servicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reembolsos_transacciones" ADD CONSTRAINT "reembolsos_transacciones_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reembolsos_transacciones" ADD CONSTRAINT "reembolsos_transacciones_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets_soporte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reembolsos_transacciones" ADD CONSTRAINT "reembolsos_transacciones_autorizadoPorUsuarioId_fkey" FOREIGN KEY ("autorizadoPorUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reembolsos_transacciones" ADD CONSTRAINT "reembolsos_transacciones_segundoAutorizadorId_fkey" FOREIGN KEY ("segundoAutorizadorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
