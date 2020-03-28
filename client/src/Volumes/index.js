import React, { useState, useEffect, useMemo } from "react";
import { withRouter } from "react-router-dom";
import TextField from "@material-ui/core/TextField";

import {
  getData,
  atualizaVolume,
  deletaVolume,
  criaVolume,
  atualizaAssociacao,
  deletaAssociacao,
  criaAssociacao
} from "./api";
import { MessageSnackBar, MaterialTable } from "../helpers";
import styles from "./styles";
import { handleApiError } from "../services";

export default withRouter(props => {
  const classes = styles();

  const [volumes, setVolumes] = useState([]);
  const [tiposProduto, setTiposProduto] = useState([]);
  const [associacao, setAssociacao] = useState([]);

  const [snackbar, setSnackbar] = useState("");
  const [refresh, setRefresh] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    const load = async () => {
      try {
        const response = await getData();
        if (!response || !isCurrent) return;

        setVolumes(response.volumes);
        setTiposProduto(response.tipoProduto);
        setAssociacao(response.associacao);
        setLoaded(true);
      } catch (err) {
        if (!isCurrent) return;
        handleApiError(err, setSnackbar);
      }
    };
    load();

    return () => {
      isCurrent = false;
    };
  }, [refresh]);

  const handleAdd = async newData => {
    try {
      const response = await criaVolume(newData.volume);
      if (!response) return;

      setRefresh(new Date());
      setSnackbar({
        status: "success",
        msg: "Volume de armazenamento adicionado com sucesso",
        date: new Date()
      });
    } catch (err) {
      handleApiError(err, setSnackbar);
    }
  };

  const handleUpdate = async (newData, oldData) => {
    try {
      const response = await atualizaVolume(newData.id, newData.volume);
      if (!response) return;

      setRefresh(new Date());
      setSnackbar({
        status: "success",
        msg: "Volume de armazenamento atualizado com sucesso",
        date: new Date()
      });
    } catch (err) {
      handleApiError(err, setSnackbar);
    }
  };

  const handleDelete = async oldData => {
    try {
      const response = await deletaVolume(oldData.id);
      if (!response) return;

      setRefresh(new Date());
      setSnackbar({
        status: "success",
        msg: "Volume de armazenamento deletado com sucesso",
        date: new Date()
      });
    } catch (err) {
      handleApiError(err, setSnackbar);
    }
  };

  const handleAddAssociacao = async newData => {
    try {
      const tipo_produto_id = +newData.tipo_produto_id;
      const volume_armazenamento_id = +newData.volume_armazenamento_id;
      const primario = !!newData.primario;
      const response = await criaAssociacao(
        tipo_produto_id,
        volume_armazenamento_id,
        primario
      );
      if (!response) return;

      setRefresh(new Date());
      setSnackbar({
        status: "success",
        msg: "Associação de volumes adicionada com sucesso",
        date: new Date()
      });
    } catch (err) {
      handleApiError(err, setSnackbar);
    }
  };

  const handleUpdateAssociacao = async (newData, oldData) => {
    try {
      const tipo_produto_id = +newData.tipo_produto_id;
      const volume_armazenamento_id = +newData.volume_armazenamento_id;
      const primario = !!newData.primario;
      const response = await atualizaAssociacao(
        newData.id,
        tipo_produto_id,
        volume_armazenamento_id,
        primario
      );
      if (!response) return;

      setRefresh(new Date());
      setSnackbar({
        status: "success",
        msg: "Associação de volumes atualizada com sucesso",
        date: new Date()
      });
    } catch (err) {
      handleApiError(err, setSnackbar);
    }
  };

  const handleDeleteAssociacao = async oldData => {
    try {
      const response = await deletaAssociacao(oldData.id);
      if (!response) return;

      setRefresh(new Date());
      setSnackbar({
        status: "success",
        msg: "Associação de volumes deletada com sucesso",
        date: new Date()
      });
    } catch (err) {
      handleApiError(err, setSnackbar);
    }
  };

  const volumesLookup = useMemo(() => {
    const lookup = {};
    volumes.forEach(v => {
      lookup[v.id] = v.volume;
    });
    return lookup;
  }, [volumes]);

  const tiposProdutoLookup = useMemo(() => {
    const lookup = {};
    tiposProduto.forEach(v => {
      lookup[v.id] = v.nome;
    });
    return lookup;
  }, [tiposProduto]);

  return (
    <>
      <MaterialTable
        title="Volumes de armazenamento"
        loaded={loaded}
        columns={[
          {
            title: "Nome",
            field: "volume",
            editComponent: props => (
              <TextField
                type="text"
                value={props.value || ""}
                className={classes.textField}
                onChange={e => props.onChange(e.target.value)}
              />
            )
          }
        ]}
        data={volumes}
        editable={{
          onRowAdd: handleAdd,
          onRowUpdate: handleUpdate,
          onRowDelete: handleDelete
        }}
      />
      <MaterialTable
        title="Associação de volumes"
        loaded={loaded}
        columns={[
          {
            title: "Volume de armazenamento",
            field: "volume_armazenamento_id",
            lookup: volumesLookup
          },
          {
            title: "Tipo de produto",
            field: "tipo_produto_id",
            lookup: tiposProdutoLookup
          },
          {
            title: "Volume primário",
            field: "primario",
            type: "boolean"
          }
        ]}
        data={associacao}
        editable={{
          onRowAdd: handleAddAssociacao,
          onRowUpdate: handleUpdateAssociacao,
          onRowDelete: handleDeleteAssociacao
        }}
      />
      {snackbar ? (
        <MessageSnackBar
          status={snackbar.status}
          key={snackbar.date}
          msg={snackbar.msg}
        />
      ) : null}
    </>
  );
});
