// Data set number 1
// Date: 9/11/2024

const maxCol = 20

const db1 = document.querySelector("#db_1");

// get no of downloads for statistic
// const noDownloads = db1.querySelector(".db--forms").querySelector("#stats");
// console.log(noDownloads.innerHTML) // <-- TODO: show google analytics

// button for google analytics
// const db1Btn = db1.querySelector(".db--forms").querySelector("button");
// db1Btn.addEventListener("click", () => {
//   console.log("download"); // <-- TODO: add google analytics
// });



// snippet is autometed from csv text as shown below.
const db1Snippet = `ECNumber,EnzymeType,Organism,Canonical SMILES,Substrate,sequence,kcat_Value,kcat_Unit,km_Value,km_Unit,Type_x,UniprotID_x,PubMedID_x,mutantSites_x,Source_x,Type_y,UniprotID_y,PubMedID_y,mutantSites_y,Source_y
1.1.1.1,wildtype,Aeropyrum pernix,C1=CC(=C[N+](=C1)C2C(C(C(O2)COP(=O)([O-])OP(=O)(O)OCC3C(C(C(O3)N4C=NC5=C(N=CN=C54)N)O)O)O)O)C(=O)N,nad+,MKAARLHEYNKPLRIEDVDYPRLEGRFDVIVRIAGAGVCHTDLHLVQGMWHELLQPKLPYTLGHENVGYIEEVAEGVEGLEKGDPVILHPAVTDGTCLACRAGEDMHCENLEFPGLNIDGGFAEFMRTSHRSVIKLPKDISREKLVEMAPLADAGITAYRAVKKAARTLYPGAYVAIVGVGGLGHIAVQLLKVMTPATVIALDVKEEKLKLAERLGADHVVDARRDPVKQVMELTRGRGVNVAMDFVGSQATVDYTPYLLGRMGRLIIVGYGGELRFPTIRVISSEVSFEGSLVGNYVELHELVTLALQGKVRVEVDIHKLDEINDVLERLEKGEVLGRAVLIP,0.4,s^(-1),0.000001,M,km,Q9Y9P9,16233615,,BRENDA,kcat,Q9Y9P9,16233615,,BRENDA
1.1.1.1,wildtype,Aeropyrum pernix,C1=CC=C(C=C1)C=O,benzaldehyde,MKAARLHEYNKPLRIEDVDYPRLEGRFDVIVRIAGAGVCHTDLHLVQGMWHELLQPKLPYTLGHENVGYIEEVAEGVEGLEKGDPVILHPAVTDGTCLACRAGEDMHCENLEFPGLNIDGGFAEFMRTSHRSVIKLPKDISREKLVEMAPLADAGITAYRAVKKAARTLYPGAYVAIVGVGGLGHIAVQLLKVMTPATVIALDVKEEKLKLAERLGADHVVDARRDPVKQVMELTRGRGVNVAMDFVGSQATVDYTPYLLGRMGRLIIVGYGGELRFPTIRVISSEVSFEGSLVGNYVELHELVTLALQGKVRVEVDIHKLDEINDVLERLEKGEVLGRAVLIP,1.22,s^(-1),0.000333,M,km,Q9Y9P9,16233615,,BRENDA,kcat,Q9Y9P9,16233615,,BRENDA
1.1.1.1,wildtype,Aeropyrum pernix,C1=CC=C(C=C1)CO,benzyl alcohol,MKAARLHEYNKPLRIEDVDYPRLEGRFDVIVRIAGAGVCHTDLHLVQGMWHELLQPKLPYTLGHENVGYIEEVAEGVEGLEKGDPVILHPAVTDGTCLACRAGEDMHCENLEFPGLNIDGGFAEFMRTSHRSVIKLPKDISREKLVEMAPLADAGITAYRAVKKAARTLYPGAYVAIVGVGGLGHIAVQLLKVMTPATVIALDVKEEKLKLAERLGADHVVDARRDPVKQVMELTRGRGVNVAMDFVGSQATVDYTPYLLGRMGRLIIVGYGGELRFPTIRVISSEVSFEGSLVGNYVELHELVTLALQGKVRVEVDIHKLDEINDVLERLEKGEVLGRAVLIP,1.02,s^(-1),0.00543,M,km,Q9Y9P9,16233615,,BRENDA,kcat,Q9Y9P9,16233615,,BRENDA
1.1.1.1,wildtype,Aeropyrum pernix,C1C=CN(C=C1C(=O)N)C2C(C(C(O2)COP(=O)(O)OP(=O)(O)OCC3C(C(C(O3)N4C=NC5=C(N=CN=C54)N)O)O)O)O,nadh,MKAARLHEYNKPLRIEDVDYPRLEGRFDVIVRIAGAGVCHTDLHLVQGMWHELLQPKLPYTLGHENVGYIEEVAEGVEGLEKGDPVILHPAVTDGTCLACRAGEDMHCENLEFPGLNIDGGFAEFMRTSHRSVIKLPKDISREKLVEMAPLADAGITAYRAVKKAARTLYPGAYVAIVGVGGLGHIAVQLLKVMTPATVIALDVKEEKLKLAERLGADHVVDARRDPVKQVMELTRGRGVNVAMDFVGSQATVDYTPYLLGRMGRLIIVGYGGELRFPTIRVISSEVSFEGSLVGNYVELHELVTLALQGKVRVEVDIHKLDEINDVLERLEKGEVLGRAVLIP,0.41,s^(-1),0.0000004,M,km,Q9Y9P9,16233615,,BRENDA,kcat,Q9Y9P9,16233615,,BRENDA
1.1.1.1,wildtype,Aeropyrum pernix,C1CCC(=O)CC1,cyclohexanone,MKAARLHEYNKPLRIEDVDYPRLEGRFDVIVRIAGAGVCHTDLHLVQGMWHELLQPKLPYTLGHENVGYIEEVAEGVEGLEKGDPVILHPAVTDGTCLACRAGEDMHCENLEFPGLNIDGGFAEFMRTSHRSVIKLPKDISREKLVEMAPLADAGITAYRAVKKAARTLYPGAYVAIVGVGGLGHIAVQLLKVMTPATVIALDVKEEKLKLAERLGADHVVDARRDPVKQVMELTRGRGVNVAMDFVGSQATVDYTPYLLGRMGRLIIVGYGGELRFPTIRVISSEVSFEGSLVGNYVELHELVTLALQGKVRVEVDIHKLDEINDVLERLEKGEVLGRAVLIP,1.27,s^(-1),0.00139,M,km,Q9Y9P9,16233615,,BRENDA,kcat,Q9Y9P9,16233615,,BRENDA`;

const db1SnippetArr = db1Snippet.split("\n");
// index 0 is header, index 1-5 is data
const db1THead = db1.querySelector("table").querySelector("thead");
const db1TBody = db1.querySelector("table").querySelector("tbody");
for (let i = 0; i < db1SnippetArr.length; i++) {
  const trElem = document.createElement("tr");
  if (i === 0) {
    db1SnippetArr[i].split(",").forEach((header, index) => {
      if (index < maxCol) {
      const thElem = document.createElement("th");
      thElem.appendChild(document.createTextNode(header));
      trElem.appendChild(thElem);
      } else if (index == maxCol) {

        const thElem = document.createElement("th");
        thElem.appendChild(document.createTextNode("More..."));
        trElem.appendChild(thElem);
      }
    });
    db1THead.appendChild(trElem);
  } else {
    db1SnippetArr[i].split(",").forEach((data, index) => {
      if (index < maxCol) {
        const tdElem = document.createElement("td");
        tdElem.appendChild(document.createTextNode(data));
        trElem.appendChild(tdElem);
      } else if (index == maxCol) {
        
        const tdElem = document.createElement("td");
        tdElem.appendChild(document.createTextNode("More..."));
        trElem.appendChild(tdElem);
      }
    });
    db1TBody.appendChild(trElem);
  }

  if (i === db1SnippetArr.length - 1) {
    const lastRow = document.createElement("tr");
    const tdElem = document.createElement("td");
    tdElem.appendChild(document.createTextNode("Click download for more......"));
    tdElem.colSpan = maxCol + 1
    lastRow.appendChild(tdElem);
    db1TBody.appendChild(lastRow);
  }
}
