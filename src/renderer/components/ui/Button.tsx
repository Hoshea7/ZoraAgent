import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
  size?: "sm" | "md" | "lg";
}

/**
 * 按钮组件
 * 支持多种样式变体和尺寸
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          // 基础样式
          "inline-flex items-center justify-center rounded-full font-medium transition-all duration-200",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // 变体样式
          variant === "primary" &&
            "bg-stone-800 text-white hover:bg-stone-700 hover:shadow-md active:scale-[0.98] disabled:bg-stone-100 disabled:text-stone-400 disabled:shadow-none disabled:active:scale-100",
          variant === "secondary" &&
            "border border-stone-200/70 bg-white text-stone-600 hover:border-stone-300/80 hover:bg-stone-50 active:bg-stone-100 disabled:bg-stone-50",
          variant === "ghost" && "text-stone-500 hover:bg-stone-100/60 active:bg-stone-200/60",
          variant === "danger" &&
            "bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.98] disabled:bg-rose-200",
          variant === "danger-ghost" &&
            "text-stone-500 hover:bg-rose-50/70 hover:text-rose-600 hover:ring-1 hover:ring-rose-200 active:bg-rose-100 disabled:opacity-50",
          // 尺寸样式 (使用 Tailwind 语义化字体大小)
          size === "sm" && "px-3 py-1.5 text-sm",
          size === "md" && "px-4 py-2 text-base",
          size === "lg" && "px-5 py-2.5 text-lg",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
