// components/elements/Pill
import React from "react";

const Pill: React.FC<{
  icon: React.ReactNode;
  text: string;
  letter: string;

  active?: boolean;
  size?: "sm" | "md" | "lg";
  type?: "cell"
}> = ({ icon, text, letter}) => {
  return <button className="rounded-md h-max w-max p-4 flex">
    {icon}
    {text}
    {letter}
  </button>
};

export { Pill }; 