-- CreateEnum
CREATE TYPE "estado_intento_pago" AS ENUM ('PENDIENTE', 'PENDIENTE_CONCILIACION', 'APROBADO', 'RECHAZADO', 'ANULADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "permiso_interno" AS ENUM ('SOPORTE_OPERATIVO', 'SOPORTE_NIVEL_2', 'ADMIN_FINANCIERO');

-- CreateEnum
CREATE TYPE "estado_inspeccion_garantia" AS ENUM ('PENDIENTE_ASIGNACION', 'ASIGNADA', 'EN_CURSO', 'DICTAMINADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "tipo_contingencia_operativa" AS ENUM ('FALLO_OTP_INICIO', 'FALLO_OTP_CIERRE', 'INCOMPARECENCIA_CLIENTE', 'INCOMPARECENCIA_REPARADOR', 'DESVIO_RUTA_O_DEMORA');

-- CreateEnum
CREATE TYPE "resultado_intervencion" AS ENUM ('RESUELTO_INICIO_FORZADO', 'RESUELTO_CIERRE_FORZADO', 'CANCELADO_INCOMPARECENCIA', 'RECHAZADO_SIN_EVIDENCIA');

-- CreateEnum
CREATE TYPE "tipo_reembolso" AS ENUM ('TOTAL', 'PARCIAL');

-- CreateEnum
CREATE TYPE "tipo_ajuste_liquidacion" AS ENUM ('DESCUENTO_GARANTIA', 'PENALIZACION_INCOMPARECENCIA', 'COMPENSACION_INCOMPARECENCIA_CLIENTE', 'AJUSTE_ARBITRAJE');

-- CreateEnum
CREATE TYPE "estado_outbox" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO');

-- AlterTable
ALTER TABLE "reembolsos_transacciones" ADD COLUMN     "claveIdempotencia" VARCHAR(100),
ADD COLUMN     "estadoProveedor" VARCHAR(50),
ADD COLUMN     "intentoPagoWompiId" UUID,
ADD COLUMN     "tipoReembolso" "tipo_reembolso",
ADD COLUMN     "wompiTransactionId" VARCHAR(100);

-- CreateTable
CREATE TABLE "intentos_pago_wompi" (
    "id" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "referenciaWompi" VARCHAR(100) NOT NULL,
    "montoEnCentavos" BIGINT NOT NULL,
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "estado" "estado_intento_pago" NOT NULL DEFAULT 'PENDIENTE',
    "estadoProveedor" VARCHAR(30),
    "ambiente" VARCHAR(10) NOT NULL DEFAULT 'test',
    "wompiTransactionId" VARCHAR(100),
    "metodoPagoReportado" VARCHAR(50),
    "firmaIntegridad" VARCHAR(255) NOT NULL,
    "datosRespuestaJson" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intentos_pago_wompi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_webhook_wompi" (
    "id" UUID NOT NULL,
    "claveDeduplicacion" VARCHAR(128) NOT NULL,
    "ambiente" VARCHAR(10) NOT NULL,
    "tipoEvento" VARCHAR(50) NOT NULL,
    "timestampEvento" INTEGER NOT NULL,
    "wompiTransactionId" VARCHAR(100),
    "checksumRecibido" VARCHAR(64) NOT NULL,
    "resumenPayloadJson" TEXT,
    "procesadoExitoso" BOOLEAN NOT NULL DEFAULT false,
    "errorProcesamiento" VARCHAR(500),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_webhook_wompi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_permisos_internos" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "permiso" "permiso_interno" NOT NULL,
    "asignadoPorUsuarioId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_permisos_internos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidencias_multimedia_reclamacion" (
    "id" UUID NOT NULL,
    "reclamacionId" UUID NOT NULL,
    "archivoKey" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "tamanoBytes" INTEGER NOT NULL,
    "duracionSegundos" INTEGER,
    "subidoPorUsuarioId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidencias_multimedia_reclamacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_inspeccion_garantia" (
    "id" UUID NOT NULL,
    "numeroInspeccion" VARCHAR(50) NOT NULL,
    "reclamacionId" UUID NOT NULL,
    "ordenOriginalId" UUID NOT NULL,
    "reparadorId" UUID,
    "estado" "estado_inspeccion_garantia" NOT NULL DEFAULT 'PENDIENTE_ASIGNACION',
    "direccionInspeccion" VARCHAR(255) NOT NULL,
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "fechaProgramada" TIMESTAMP(3),
    "fechaAsignacion" TIMESTAMP(3),
    "fechaDictamen" TIMESTAMP(3),
    "dictamenDetalle" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_inspeccion_garantia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intervenciones_operativas" (
    "id" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "agenteId" UUID NOT NULL,
    "tipoContingencia" "tipo_contingencia_operativa" NOT NULL,
    "resultado" "resultado_intervencion" NOT NULL,
    "justificacion" TEXT NOT NULL,
    "latitudRegistrada" DECIMAL(10,7),
    "longitudRegistrada" DECIMAL(10,7),
    "distanciaCalculadaMetros" DECIMAL(8,2),
    "antiguedadTelemetriaSegundos" INTEGER,
    "referenciaContactoTelefonico" VARCHAR(100),
    "contactoConfirmado" BOOLEAN NOT NULL DEFAULT false,
    "estadoAnterior" "estado_orden" NOT NULL,
    "estadoNuevo" "estado_orden" NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intervenciones_operativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muestras_telemetria_reparador" (
    "id" UUID NOT NULL,
    "reparadorId" UUID NOT NULL,
    "ordenId" UUID NOT NULL,
    "latitud" DECIMAL(10,7) NOT NULL,
    "longitud" DECIMAL(10,7) NOT NULL,
    "precisionMetros" DECIMAL(6,2),
    "distanciaCalculadaMetros" DECIMAL(8,2),
    "enSitio" BOOLEAN NOT NULL DEFAULT false,
    "recibidoEnServidor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muestras_telemetria_reparador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_liquidacion_reparador" (
    "id" UUID NOT NULL,
    "reparadorId" UUID NOT NULL,
    "ordenId" UUID,
    "reembolsoId" UUID,
    "tipo" "tipo_ajuste_liquidacion" NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "aplicadoPorId" UUID NOT NULL,
    "claveIdempotencia" VARCHAR(100) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_liquidacion_reparador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones_outbox" (
    "id" UUID NOT NULL,
    "tipoEvento" VARCHAR(50) NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "destinatarioEmail" VARCHAR(255) NOT NULL,
    "estado" "estado_outbox" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" VARCHAR(500),
    "claveIdempotencia" VARCHAR(100) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadoEn" TIMESTAMP(3),

    CONSTRAINT "notificaciones_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intentos_pago_wompi_referenciaWompi_key" ON "intentos_pago_wompi"("referenciaWompi");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_pago_wompi_wompiTransactionId_key" ON "intentos_pago_wompi"("wompiTransactionId");

-- CreateIndex
CREATE INDEX "intentos_pago_wompi_ordenId_idx" ON "intentos_pago_wompi"("ordenId");

-- CreateIndex
CREATE INDEX "intentos_pago_wompi_estado_creadoEn_idx" ON "intentos_pago_wompi"("estado", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_webhook_wompi_claveDeduplicacion_key" ON "eventos_webhook_wompi"("claveDeduplicacion");

-- CreateIndex
CREATE INDEX "eventos_webhook_wompi_wompiTransactionId_idx" ON "eventos_webhook_wompi"("wompiTransactionId");

-- CreateIndex
CREATE INDEX "eventos_webhook_wompi_ambiente_creadoEn_idx" ON "eventos_webhook_wompi"("ambiente", "creadoEn");

-- CreateIndex
CREATE INDEX "usuario_permisos_internos_usuarioId_idx" ON "usuario_permisos_internos"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_permisos_internos_usuarioId_permiso_key" ON "usuario_permisos_internos"("usuarioId", "permiso");

-- CreateIndex
CREATE INDEX "evidencias_multimedia_reclamacion_reclamacionId_idx" ON "evidencias_multimedia_reclamacion"("reclamacionId");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_inspeccion_garantia_numeroInspeccion_key" ON "ordenes_inspeccion_garantia"("numeroInspeccion");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_inspeccion_garantia_reclamacionId_key" ON "ordenes_inspeccion_garantia"("reclamacionId");

-- CreateIndex
CREATE INDEX "ordenes_inspeccion_garantia_ordenOriginalId_idx" ON "ordenes_inspeccion_garantia"("ordenOriginalId");

-- CreateIndex
CREATE INDEX "ordenes_inspeccion_garantia_reparadorId_idx" ON "ordenes_inspeccion_garantia"("reparadorId");

-- CreateIndex
CREATE INDEX "intervenciones_operativas_ordenId_idx" ON "intervenciones_operativas"("ordenId");

-- CreateIndex
CREATE INDEX "intervenciones_operativas_agenteId_idx" ON "intervenciones_operativas"("agenteId");

-- CreateIndex
CREATE INDEX "muestras_telemetria_reparador_ordenId_recibidoEnServidor_idx" ON "muestras_telemetria_reparador"("ordenId", "recibidoEnServidor");

-- CreateIndex
CREATE INDEX "muestras_telemetria_reparador_reparadorId_recibidoEnServido_idx" ON "muestras_telemetria_reparador"("reparadorId", "recibidoEnServidor");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_liquidacion_reparador_claveIdempotencia_key" ON "movimientos_liquidacion_reparador"("claveIdempotencia");

-- CreateIndex
CREATE INDEX "movimientos_liquidacion_reparador_reparadorId_creadoEn_idx" ON "movimientos_liquidacion_reparador"("reparadorId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "notificaciones_outbox_claveIdempotencia_key" ON "notificaciones_outbox"("claveIdempotencia");

-- CreateIndex
CREATE INDEX "notificaciones_outbox_estado_creadoEn_idx" ON "notificaciones_outbox"("estado", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "reembolsos_transacciones_claveIdempotencia_key" ON "reembolsos_transacciones"("claveIdempotencia");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_wompiTransactionId_idx" ON "reembolsos_transacciones"("wompiTransactionId");

-- CreateIndex
CREATE INDEX "reembolsos_transacciones_intentoPagoWompiId_idx" ON "reembolsos_transacciones"("intentoPagoWompiId");

-- AddForeignKey
ALTER TABLE "reembolsos_transacciones" ADD CONSTRAINT "reembolsos_transacciones_intentoPagoWompiId_fkey" FOREIGN KEY ("intentoPagoWompiId") REFERENCES "intentos_pago_wompi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intentos_pago_wompi" ADD CONSTRAINT "intentos_pago_wompi_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_permisos_internos" ADD CONSTRAINT "usuario_permisos_internos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_permisos_internos" ADD CONSTRAINT "usuario_permisos_internos_asignadoPorUsuarioId_fkey" FOREIGN KEY ("asignadoPorUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_multimedia_reclamacion" ADD CONSTRAINT "evidencias_multimedia_reclamacion_reclamacionId_fkey" FOREIGN KEY ("reclamacionId") REFERENCES "reclamaciones_garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_multimedia_reclamacion" ADD CONSTRAINT "evidencias_multimedia_reclamacion_subidoPorUsuarioId_fkey" FOREIGN KEY ("subidoPorUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_inspeccion_garantia" ADD CONSTRAINT "ordenes_inspeccion_garantia_reclamacionId_fkey" FOREIGN KEY ("reclamacionId") REFERENCES "reclamaciones_garantia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_inspeccion_garantia" ADD CONSTRAINT "ordenes_inspeccion_garantia_ordenOriginalId_fkey" FOREIGN KEY ("ordenOriginalId") REFERENCES "ordenes_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_inspeccion_garantia" ADD CONSTRAINT "ordenes_inspeccion_garantia_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervenciones_operativas" ADD CONSTRAINT "intervenciones_operativas_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intervenciones_operativas" ADD CONSTRAINT "intervenciones_operativas_agenteId_fkey" FOREIGN KEY ("agenteId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muestras_telemetria_reparador" ADD CONSTRAINT "muestras_telemetria_reparador_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muestras_telemetria_reparador" ADD CONSTRAINT "muestras_telemetria_reparador_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_liquidacion_reparador" ADD CONSTRAINT "movimientos_liquidacion_reparador_reparadorId_fkey" FOREIGN KEY ("reparadorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_liquidacion_reparador" ADD CONSTRAINT "movimientos_liquidacion_reparador_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_liquidacion_reparador" ADD CONSTRAINT "movimientos_liquidacion_reparador_reembolsoId_fkey" FOREIGN KEY ("reembolsoId") REFERENCES "reembolsos_transacciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_liquidacion_reparador" ADD CONSTRAINT "movimientos_liquidacion_reparador_aplicadoPorId_fkey" FOREIGN KEY ("aplicadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
