-- Migration 1: Step 1a - Enums and Types for Fixi Wallet Phase 1
-- Separated to ensure new enum values are committed before usage in table definitions

-- 1. Alter existing enum tipo_movimiento_wallet
ALTER TYPE "tipo_movimiento_wallet" ADD VALUE IF NOT EXISTS 'AJUSTE_COMPENSATORIO';

-- 2. Alter existing enum estado_reembolso
ALTER TYPE "estado_reembolso" ADD VALUE IF NOT EXISTS 'pendiente_segunda_aprobacion';
ALTER TYPE "estado_reembolso" ADD VALUE IF NOT EXISTS 'autorizado';
ALTER TYPE "estado_reembolso" ADD VALUE IF NOT EXISTS 'rechazado';

-- 3. Create new enums safely
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'naturaleza_movimiento_wallet') THEN
        CREATE TYPE "naturaleza_movimiento_wallet" AS ENUM ('CREDITO', 'DEBITO');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_recarga_wallet') THEN
        CREATE TYPE "estado_recarga_wallet" AS ENUM (
            'PENDIENTE',
            'APROBADA',
            'RECHAZADA',
            'EN_DISPUTA',
            'ANULADA_WOMPI',
            'REVERSADA_ADMIN',
            'ANOMALIA_CONFIRMACION_TARDIA'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_conciliacion_recarga') THEN
        CREATE TYPE "estado_conciliacion_recarga" AS ENUM (
            'CONCILIADO',
            'PENDIENTE_INVESTIGACION',
            'AJUSTADO_MANUAL'
        );
    END IF;
END $$;
