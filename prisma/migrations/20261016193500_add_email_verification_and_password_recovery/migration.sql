-- CreateTable
CREATE TABLE "verificaciones_correo" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "correoDestino" VARCHAR(150) NOT NULL,
    "codigoHash" VARCHAR(64) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "maxIntentos" INTEGER NOT NULL DEFAULT 5,
    "reenvios" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaExpira" TIMESTAMP(3) NOT NULL,
    "consumidoEn" TIMESTAMP(3),
    "invalidadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verificaciones_correo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_recuperacion_password" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "ipSolicitud" VARCHAR(45),
    "userAgent" TEXT,
    "fechaExpira" TIMESTAMP(3) NOT NULL,
    "consumidoEn" TIMESTAMP(3),
    "invalidadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_recuperacion_password_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verificaciones_correo_usuarioId_consumidoEn_invalidadoEn_idx" ON "verificaciones_correo"("usuarioId", "consumidoEn", "invalidadoEn");

-- CreateIndex
CREATE INDEX "verificaciones_correo_correoDestino_creadoEn_idx" ON "verificaciones_correo"("correoDestino", "creadoEn");

-- CreateIndex
CREATE INDEX "verificaciones_correo_fechaExpira_idx" ON "verificaciones_correo"("fechaExpira");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_recuperacion_password_tokenHash_key" ON "tokens_recuperacion_password"("tokenHash");

-- CreateIndex
CREATE INDEX "tokens_recuperacion_password_usuarioId_consumidoEn_invalida_idx" ON "tokens_recuperacion_password"("usuarioId", "consumidoEn", "invalidadoEn");

-- CreateIndex
CREATE INDEX "tokens_recuperacion_password_fechaExpira_idx" ON "tokens_recuperacion_password"("fechaExpira");

-- AddForeignKey
ALTER TABLE "verificaciones_correo" ADD CONSTRAINT "verificaciones_correo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_recuperacion_password" ADD CONSTRAINT "tokens_recuperacion_password_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
