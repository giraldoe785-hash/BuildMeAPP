import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "emergency" | "info" | "outline" | "neutral";
  size?: "sm" | "md";
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = "default",
  size = "md",
  children,
  ...props
}) => {
  const baseStyles = "inline-flex items-center font-medium rounded-full tracking-wide";

  const sizeStyles = {
    sm: "px-2 py-0.5 text-[11px] gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5",
  };

  const variantStyles = {
    default: "bg-emerald-50 text-emerald-700 border border-emerald-200/80",
    success: "bg-emerald-100 text-emerald-800 border border-emerald-300",
    warning: "bg-amber-50 text-amber-800 border border-amber-200",
    emergency: "bg-orange-50 text-orange-700 border border-orange-200 font-semibold",
    info: "bg-blue-50 text-blue-700 border border-blue-200",
    neutral: "bg-slate-100 text-slate-700 border border-slate-200",
    outline: "bg-transparent text-slate-600 border border-slate-300",
  };

  return (
    <span
      className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}
      {...props}
    >
      {children}
    </span>
  );
};
