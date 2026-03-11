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
          "inline-flex items-center justify-center rounded-full font-medium transition-all duration-200",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // 变体样式
          variant === "primary" &&
            "bg-stone-900 text-white hover:bg-stone-800 hover:shadow-md active:scale-[0.98] disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none disabled:active:scale-100",
          variant === "secondary" &&
            "border border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50 active:bg-stone-100 disabled:bg-stone-50",
          variant === "ghost" && "text-stone-600 hover:bg-stone-100 active:bg-stone-200",
          // 尺寸样式
          size === "sm" && "px-3 py-1.5 text-[13px]",
          size === "md" && "px-4 py-2 text-[14px]",
          size === "lg" && "px-5 py-2.5 text-[15px]",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
