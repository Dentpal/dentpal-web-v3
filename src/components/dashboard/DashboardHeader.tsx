import { Button } from "@/components/ui/button";
import { Search, Settings } from "lucide-react";
import NotificationCenter from "@/components/notifications/NotificationCenter";

interface DashboardHeaderProps {
  title: string;
  subtitle: string;
}

const DashboardHeader = ({ title, subtitle }: DashboardHeaderProps) => {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-600">{subtitle}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Temporarily commented out - search, notification, and settings icons */}
          {/* <Button variant="ghost" size="icon">
            <Search className="h-4 w-4" />
          </Button>
          
          <NotificationCenter />
          
          <Button variant="ghost" size="icon">
            <Settings className="h-4 w-4" />
          </Button> */}
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
