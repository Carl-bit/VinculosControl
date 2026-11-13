-- CreateEnum
CREATE TYPE "tipo_job" AS ENUM ('VERIFICAR', 'APROVISIONAR', 'RECONFIGURAR', 'ACTUALIZAR', 'REINICIAR_DEMO', 'EXPORTAR', 'ELIMINAR');

-- CreateEnum
CREATE TYPE "estado_job" AS ENUM ('PENDIENTE', 'EN_CURSO', 'ESPERANDO_LLAVES', 'FALLIDO', 'OK', 'CANCELADO');

-- CreateEnum
CREATE TYPE "estado_paso" AS ENUM ('PENDIENTE', 'EN_CURSO', 'OK', 'FALLIDO', 'OMITIDO');

-- CreateTable
CREATE TABLE "jobs" (
    "id" SERIAL NOT NULL,
    "tipo" "tipo_job" NOT NULL,
    "estado" "estado_job" NOT NULL DEFAULT 'PENDIENTE',
    "centro_id" INTEGER,
    "silo_slug" TEXT,
    "revision" INTEGER,
    "hash_manifiesto" TEXT,
    "creado_por" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agente_id" INTEGER,
    "reclamado_en" TIMESTAMP(3),
    "reserva_hasta" TIMESTAMP(3),
    "terminado_en" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pasos_job" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "ejecutor" TEXT NOT NULL,
    "estado" "estado_paso" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "inicio_en" TIMESTAMP(3),
    "fin_en" TIMESTAMP(3),
    "log" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,

    CONSTRAINT "pasos_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_estado_creado_en_idx" ON "jobs"("estado", "creado_en");

-- CreateIndex
CREATE INDEX "jobs_centro_id_idx" ON "jobs"("centro_id");

-- CreateIndex
CREATE UNIQUE INDEX "pasos_job_job_id_codigo_key" ON "pasos_job"("job_id", "codigo");

-- AddForeignKey
ALTER TABLE "pasos_job" ADD CONSTRAINT "pasos_job_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
