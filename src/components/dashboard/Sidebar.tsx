import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  CheckCircle, 
  CreditCard,
  Key,
  Images,
  LogOut,
  Menu,
  X,
  IdCard,
  BarChart3,
  PlusSquare,
  Bell,
  ShieldCheck,
  FolderTree,
  MessageSquare,
  Package,
  History,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Edit,
  Plus,
  List
} from "lucide-react";
import dentalLogo from "@/assets/dentpal_logo.png";
import { useAuth } from "@/hooks/use-auth";
import { useProfileCompletion } from "@/hooks/useProfileCompletion";

interface SidebarProps {
  activeItem: string;
  onItemClick: (item: string) => void;
  onLogout: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: any;
  subItems?: Array<{ id: string; label: string; icon: any }>;
}

const menuItems: MenuItem[] = [
  { 
    id: "dashboard", 
    label: "Dashboard", 
    icon: LayoutDashboard,
    subItems: [
      { id: "dashboard-summary", label: "By Summary", icon: BarChart3 },
      { id: "dashboard-item", label: "By Item", icon: List },
      { id: "dashboard-category", label: "By Category", icon: FolderTree },
      { id: "dashboard-payment", label: "By Payment Type", icon: CreditCard },
      { id: "dashboard-receipts", label: "By Receipts", icon: ClipboardList }
    ]
  },
  { id: "profile", label: "Profile", icon: IdCard },
  // { id: "booking", label: "Booking", icon: Calendar }, // HIDE BOOKING FOR ADMIN
  // Booking tab is now fully hidden for all users
  { id: 'seller-orders', label: 'Seller Orders', icon: Calendar },
  // { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "items", label: "Items", icon: PlusSquare },
  { id: "chats", label: "Chats", icon: MessageSquare },
  //{ id: "notifications", label: "Notifications", icon: Bell },
  { id: "product-qc", label: "QC Product", icon: CheckCircle },
  { id: "categories", label: "Categories", icon: FolderTree },
  { id: "confirmation", label: "Confirmation", icon: CheckCircle },
  { id: "withdrawal", label: "Withdrawal", icon: CreditCard },
  { id: "sub-accounts", label: "Sub Account", icon: Users },
  { id: "access", label: "Access", icon: Key },
  { id: "images", label: "Images", icon: Images },
  { id: "users", label: "Users", icon: Users },
  { id: "policies", label: "Terms & Policies", icon: ShieldCheck },
];

const Sidebar = ({ activeItem, onItemClick, onLogout }: SidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set(['dashboard', 'inventory', 'inventory-control', 'items'])); // Expanded by default
  const { hasPermission, loading, isAdmin, isSeller, isSubAccount, role } = useAuth();
  const { vendorProfileComplete } = useProfileCompletion();

  const panelLabel = isAdmin
    ? 'Admin Panel'
    : isSeller
    ? 'Seller Panel'
    : role
    ? `${role.charAt(0).toUpperCase()}${role.slice(1)} Panel`
    : 'Panel';

  // Filter menu items based on user role
  const filteredMenuItems = useMemo(() => {
    return menuItems.map(item => {
      // For Dashboard, only show sub-items for sellers
      if (item.id === 'dashboard' && item.subItems) {
        if (isSeller && !isAdmin) {
          return item; // Keep all sub-items for sellers
        } else {
          // Remove sub-items for admins and other roles
          return { ...item, subItems: undefined };
        }
      }
      return item;
    });
  }, [isSeller, isAdmin]);

  const permissionByMenuId: Record<string, string> = {
    dashboard: "dashboard",
    profile: "profile",
    reports: "reports",
    booking: "bookings",
    'seller-orders': 'seller-orders',
    inventory: 'inventory',
    'inventory-all': 'inventory',
    'inventory-history': 'inventory',
    'inventory-control': 'inventory',
    'stock-adjustment': 'inventory',
    // 'price-management': 'add-product',
    items: 'add-product',
    'items-all': 'add-product',
    'items-list': 'add-product',
    'product-qc': 'product-qc',
    warranty: 'warranty',
    categories: 'categories',
    confirmation: "confirmation",
    withdrawal: "withdrawal",
    'sub-accounts': 'dashboard',
    access: "access",
    images: "images",
    users: "users",
    notifications: 'notifications',
    policies: "policies",
    chats: 'chats',
  };

  // Map child tabs to their parent menu items
  const parentMenuMap: Record<string, string> = {
    'inventory-all': 'inventory',
    'inventory-history': 'inventory',
    'stock-adjustment': 'inventory',
    'item-management': 'inventory',
    'items-all': 'items',
    'items-list': 'items',
    'items-add': 'items',
    'dashboard-summary': 'dashboard',
    'dashboard-item': 'dashboard',
    'dashboard-category': 'dashboard',
    'dashboard-payment': 'dashboard',
    'dashboard-receipts': 'dashboard',
  };

  const toggleMenu = (menuId: string) => {
    setExpandedMenus(prev => {
      const next = new Set(prev);
      if (next.has(menuId)) {
        next.delete(menuId);
      } else {
        next.add(menuId);
      }
      return next;
    });
  };

  const visibleMenuItems = loading
    ? []
    : (() => {
        let permitted = filteredMenuItems.filter((item) => {
          if (item.id === 'product-qc' && !isAdmin) return false;
          if (item.id === 'warranty' && !isAdmin) return false;
          if (item.id === 'categories' && !isAdmin) return false;
          if (item.id === 'profile' && isAdmin) return false;
          if (item.id === 'chats' && isAdmin) return false; // Hide chats for admin
          if (item.id === 'confirmation' && isAdmin) return false; // Hide confirmation for admin
          if (item.id === 'reports' && isAdmin) return false; // Hide reports for admin
          if (isAdmin && ['seller-orders','inventory','inventory-control','stock-adjustment','items','sub-accounts'].includes(item.id)) return false;
          const key = permissionByMenuId[item.id];

          if (isSubAccount) {
            if (!key) return false; 
            return hasPermission(key as any);
          }

          const hasPerm = hasPermission((key || 'dashboard') as any);
          return hasPerm;
        });

        if (isSubAccount) {
          permitted = permitted.filter((i) => i.id !== 'access' && i.id !== 'sub-accounts');
          return permitted;
        }

        if (isSeller && !isAdmin && !vendorProfileComplete) {
          return permitted.filter((i) => i.id === 'profile');
        }

        if (isSeller && !isAdmin) {
          const sellerOrder = ['dashboard', 'seller-orders', 'reports', 'withdrawal', 'inventory', 'inventory-control', 'items', 'chats', 'sub-accounts', 'profile'];
          const map = new Map(permitted.map((i) => [i.id, i] as const));
          const ordered = sellerOrder.map((id) => map.get(id)).filter(Boolean) as typeof permitted;
          return ordered;
        }

        return permitted;
      })();

  return (
    <div className={`bg-card border-r border-border flex flex-col transition-all duration-300 ${
      isCollapsed ? "w-16" : "w-64"
    }`}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 flex items-center justify-center">
                <img 
                  src={dentalLogo} 
                  alt="DentPal Logo" 
                  className="w-8 h-8 object-contain rounded-lg"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallbackElement = e.currentTarget.nextElementSibling as HTMLElement;
                    if (fallbackElement) {
                      fallbackElement.style.display = 'flex';
                    }
                  }}
                />
                <div className="w-8 h-8 bg-gradient-primary rounded-lg items-center justify-center hidden">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2L2 7v10c0 5.55 3.84 10 9 10s9-4.45 9-10V7l-10-5z"/>
                  </svg>
                </div>
              </div>
              <div>
                <h2 className="font-bold text-lg text-foreground">DentPal</h2>
                <p className="text-xs text-muted-foreground">{panelLabel}</p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-muted-foreground hover:text-foreground"
          >
            {isCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 p-4 overflow-y-auto">
        <nav className="space-y-1">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            // Check if this menu item is active - either directly or if activeItem is a child of this menu
            const isActive = activeItem === item.id || 
                           item.subItems?.some(sub => sub.id === activeItem) ||
                           parentMenuMap[activeItem] === item.id;
            const isExpanded = expandedMenus.has(item.id);
            const hasSubItems = item.subItems && item.subItems.length > 0;
            
            const displayLabel = (isSeller && !isAdmin)
              ? (item.id === 'dashboard' ? 'Sales' : item.id === 'seller-orders' ? 'Orders' : item.id === 'reports' ? 'Report' : item.label)
              : item.label;
            
            return (
              <div key={item.id}>
                <button
                  onClick={() => {
                    if (hasSubItems) {
                      toggleMenu(item.id);
                    } else {
                      onItemClick(item.id);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {!isCollapsed && <span className="font-medium">{displayLabel}</span>}
                  </div>
                  {!isCollapsed && hasSubItems && (
                    isExpanded ? (
                      <ChevronDown className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 flex-shrink-0" />
                    )
                  )}
                </button>
                
                {/* Sub-items */}
                {!isCollapsed && hasSubItems && isExpanded && (
                  <div className="ml-6 mt-1 space-y-1 border-l-2 border-border pl-2">
                    {item.subItems!.map((subItem) => {
                      const SubIcon = subItem.icon;
                      const isSubActive = activeItem === subItem.id;
                      
                      return (
                        <button
                          key={subItem.id}
                          onClick={() => onItemClick(subItem.id)}
                          className={`w-full flex items-center space-x-3 px-3 py-1.5 rounded-lg transition-all duration-200 text-sm ${
                            isSubActive
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent"
                          }`}
                        >
                          <SubIcon className="w-4 h-4 flex-shrink-0" />
                          <span className="font-medium">{subItem.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Logout */}
      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          onClick={onLogout}
          className={`w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 ${
            isCollapsed ? "px-0" : ""
          }`}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!isCollapsed && <span className="ml-3">Logout</span>}
        </Button>
      </div>
    </div>
  );
};

export default Sidebar;