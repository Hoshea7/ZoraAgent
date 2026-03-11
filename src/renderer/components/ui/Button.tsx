import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
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
          "inline-flex items-center justify-center rounded-full font-semibold transition",
          "disabled:cursor-not-allowed disabled:opacity-45",
          // 变体样式
          variant === "primary" &&
            "bg-stone-950 text-stone-50 hover:bg-stone-800 disabled:bg-stone-300",
          variant === "secondary" &&
            "border border-stone-900/12 text-stone-700 hover:border-stone-900/30 hover:bg-stone-100",
          variant === "ghost" && "text-stone-700 hover:bg-stone-100",
          // 尺寸样式
          size === "sm" && "px-3 py-1.5 text-xs",
          size === "md" && "px-4 py-2 text-sm",
          size === "lg" && "px-5 py-2.5 text-sm",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
