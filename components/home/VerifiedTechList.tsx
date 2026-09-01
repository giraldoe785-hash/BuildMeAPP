"use client";

import React, { useState } from "react";
import { VERIFIED_TECHNICIANS } from "@/data/technicians";
import { useFixiStore } from "@/store/useFixiStore";
import { Star, MapPin, CheckCircle2, ShieldCheck, ArrowRight, Phone, MessageSquare, Wrench } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Technician } from "@/types";

export const VerifiedTechList: React.FC = () => {
  const { startWizard, setTechInfoModalOpen } = useFixiStore();
  const [selectedTech, setSelectedTech] = useState<Technician | null>(null);

  const handleHireTech = (tech: Technician) => {
    setSelectedTech(null);
    startWizard("electricidad");
  };

  return (
    <section className="px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">
            Técnicos Verificados Cerca de Ti
          </h3>
          <p className="text-[11px] text-slate-500">
            Filtrados por radio de cercanía y alta calificación
          </p>
        </div>
        <span className="text-[11px] font-bold text-slate-500 hover:text-emerald-600 cursor-pointer">
          Ver todos ({VERIFIED_TECHNICIANS.length})
        </span>
      </div>

      <div className="space-y-3">
        {VERIFIED_TECHNICIANS.map((tech) => (
          <div
            key={tech.id}
            onClick={() => setSelectedTech(tech)}
            className="group p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer"
          >
            <div className="flex items-start gap-3">
              {/* Technician Avatar & Distance Chip */}
              <div className="relative shrink-0">
                <img
                  src={tech.avatar}
                  alt={tech.name}
                  className="w-14 h-14 rounded-2xl object-cover border border-slate-100 shadow-xs"
                />
                <span className="absolute -bottom-1.5 -right-1 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-xs flex items-center gap-0.5">
                  <ShieldCheck className="w-2.5 h-2.5" />
                  Verificado
                </span>
              </div>

              {/* Info Column */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 truncate">
                    {tech.name}
                  </h4>
                  <div className="flex items-center gap-1 text-amber-500 font-bold text-xs shrink-0">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    <span>{tech.rating.toFixed(2)}</span>
                    <span className="text-slate-400 text-[10px] font-normal">
                      ({tech.reviewCount})
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-600 font-medium truncate mt-0.5">
                  {tech.role}
                </p>

                {/* Distance & jobs count */}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                    <MapPin className="w-3 h-3 text-emerald-600" />
                    A {tech.distanceKm} km
                  </span>
                  <span>•</span>
                  <span>{tech.completedJobs} trabajos</span>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {tech.verifiedBadges.slice(0, 2).map((badge, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded-md"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Action footer inside card */}
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Tarifa estimada: <strong className="text-emerald-700 font-bold">${tech.hourlyRate}/h</strong>
              </span>
              <span className="text-xs font-bold text-emerald-600 group-hover:translate-x-1 transition-transform flex items-center gap-1">
                <span>Solicitar servicio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Detail Modal for clicked technician */}
      {selectedTech && (
        <Modal
          isOpen={!!selectedTech}
          onClose={() => setSelectedTech(null)}
          title="Ficha del Especialista"
          description="Perfil verificado por la plataforma Fixi"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3.5">
              <img
                src={selectedTech.avatar}
                alt={selectedTech.name}
                className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500 shadow-sm"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-slate-900">
                    {selectedTech.name}
                  </h3>
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-xs text-slate-600">{selectedTech.role}</p>
                <div className="flex items-center gap-1 text-amber-500 text-xs font-bold mt-1">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span>{selectedTech.rating.toFixed(2)}</span>
                  <span className="text-slate-400 font-normal">
                    ({selectedTech.reviewCount} reseñas verificadas)
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl text-xs text-slate-700 leading-relaxed border border-slate-200/70">
              <p className="font-bold text-slate-900 mb-1">Experiencia & Perfil:</p>
              {selectedTech.bio}
            </div>

            {/* Badges & Vehicle */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-emerald-50/70 rounded-xl border border-emerald-200/80">
                <span className="text-[10px] text-emerald-700 font-bold uppercase">
                  Vehículo de Despacho
                </span>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {selectedTech.vehicle.type}: {selectedTech.vehicle.model}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  Placa: {selectedTech.vehicle.plate}
                </p>
              </div>

              <div className="p-2.5 bg-slate-100 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 font-bold uppercase">
                  Tiempo de Respuesta
                </span>
                <p className="font-semibold text-slate-800 mt-0.5">
                  ~{selectedTech.responseTimeMin} minutos
                </p>
                <p className="text-[10px] text-emerald-600 font-bold">
                  En tu zona ahora
                </p>
              </div>
            </div>

            <div className="pt-2">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => handleHireTech(selectedTech)}
              >
                Continuar con Diagnóstico & Reserva
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
};
