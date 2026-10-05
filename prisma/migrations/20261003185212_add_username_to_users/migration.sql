/*
  Warnings:

  - A unique constraint covering the columns `[nombreUsuario]` on the table `usuarios` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nombreUsuario` to the `usuarios` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "nombreUsuario" VARCHAR(50) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_nombreUsuario_key" ON "usuarios"("nombreUsuario");
