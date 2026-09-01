import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "interactive" | "bordered";
}

export const Card: React.FC<CardProps> = ({
  className,
  variant = "default",
  children,
  ...props
}) => {
  const baseStyles = "bg-white rounded-2xl transition-all duration-200 overflow-hidden";

  const variantStyles = {
    default: "border border-slate-200/80 shadow-sm",
    elevated: "border border-slate-100 shadow-lg shadow-slate-200/50",
    interactive:
      "border border-slate-200/80 shadow-sm hover:shadow-md hover:border-emerald-300 hover:-translate-y-0.5 cursor-pointer active:scale-[0.99]",
    bordered: "border-2 border-dashed border-slate-200 bg-slate-50/50",
  };

  return (
    <div
      className={twMerge(clsx(baseStyles, variantStyles[variant], className))}
      {...props}
    >
      {children}
    </div>
  );
};
