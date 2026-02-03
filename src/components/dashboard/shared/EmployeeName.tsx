/**
 * EmployeeName Component
 * Displays employee name from UID using seller name map
 */

interface EmployeeNameProps {
  handledBy: string;
  sellerUidToName: Record<string, string>;
}

export const EmployeeName = ({ handledBy, sellerUidToName }: EmployeeNameProps) => {
  const name = sellerUidToName[handledBy] || handledBy;
  return <span>{name}</span>;
};
